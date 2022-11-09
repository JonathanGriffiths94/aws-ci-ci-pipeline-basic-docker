import {
    RemovalPolicy,
    aws_codepipeline,
    aws_codebuild,
    aws_codepipeline_actions,
    Stack,
    StackProps,
    aws_iam
} from 'aws-cdk-lib';
import { Construct } from 'constructs';


interface PipelineProps extends StackProps {
  codeStarId: string;
}

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineProps) {
    super(scope, id, props);

    // Artifacts
    const sourceOutput = new aws_codepipeline.Artifact("SourceOutput");
    const unitTestBuildOutput = new aws_codepipeline.Artifact("UnittestBuildOutput");
    const cdkBuildOutput = new aws_codepipeline.Artifact("CdkBuildOutput");

    // Github connection
    const sourceAction = new aws_codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: "GitHub",
      owner: "JonathanGriffiths94",
      connectionArn: `arn:aws:codestar-connections:${this.region}:${this.account}:connection/${props.codeStarId}`,
      repo: "aws-cicd-pipeline-basic-docker",
      output: sourceOutput
    });

    // CodeBuild for unit test
    const unitTestCodeBuildProject = new aws_codebuild.PipelineProject(
        this,
        "UnitTestCodeBuildProject",
        {
          projectName: "UnitTestCodeBuildProject",
          environment: {
            buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0
          },
          buildSpec: aws_codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
              install: {
                commands: ["pip install -r requirements.txt", "echo $CODE_COMMIT_ID"],
              },
              build: {
                commands: ["python -m pytest -s -v unittest/test_lambda_logic.py"],
              }
            }
          })
        }
    )

    // Role for integration test
    const role = new aws_iam.Role(this, "RoleForIntegrationTest", {
      roleName: "RoleForIntegrationTest",
      assumedBy: new aws_iam.ServicePrincipal("codebuild.amazonaws.com")
    });

    role.attachInlinePolicy(
        new aws_iam.Policy(this, "CodeBuildReadCloudFormation", {
          policyName: "CodeBuildReadCloudFormation",
          statements: [
              new aws_iam.PolicyStatement({
                actions: ["cloudformation:*"],
                resources: ["*"]
              })
          ]
        })
    )

      // CodeBuild for integration test
    const integTestCodeBuildProject = new aws_codebuild.PipelineProject(
      this,
      "CodeBuildIntegTest",
      {
        role: role,
        environment: {
          buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0
        },
        buildSpec: aws_codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              commands: [
                  `SERVICE_URL=$(aws cloudformation describe-stacks --stack-name PreProdApplicationStack
                  --query "Stacks[0].Outputs[OutputKey=='UrlPreProd'].OutputValue" --output text)`,
                  "echo $SERVICE_URL",
                  "pip install -r requirements.txt"
              ]
            },
            build: {
              commands: ["python -m pytest -s -v integ_tests/test_service.py"],
            }
          },
          artifacts: {}
        })
      }
    )

    // CodeBuild to build cdk stack
    const cdkBuildProject = new aws_codebuild.PipelineProject(
        this,
        "CdkBuildProject",{
          environment: {
            buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0
          },
          buildSpec: aws_codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
              install: {
                commands: ["npm install"]
              },
              build: {
                commands: ["npm run cdk synth -- -o dist"]
              }
            },
            artifacts: {
              "base-directory": "dist",
              files: ["*.template.json"]
            }
          })
        }
    );

    // Unit test CodeBuild action
    const unitTestBuildAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: "DoUnitTest",
      project: unitTestCodeBuildProject,
      input: sourceOutput,
      outputs: [unitTestBuildOutput],
      environmentVariables: {
        CODE_COMMIT_ID: {
          value: sourceAction.variables.commitId
        }
      }
    });


    // Integration CodeBuild action
    const integTestBuildAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: "IntegTest",
      project: integTestCodeBuildProject,
      input: sourceOutput
    });

    // Cdk build action
    const cdkBuild = new aws_codepipeline_actions.CodeBuildAction({
        actionName: "BuildCfnTemplate",
        project: cdkBuildProject,
        input: sourceOutput,
        outputs: [cdkBuildOutput]
    })

    // CodedDeploy to deploy pre-production api
    const deployPreProd = new aws_codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: "DeployPreProdApplication",
        templatePath: cdkBuildOutput.atPath(
            "PreProdApplicationStack.template.json"
        ),
        stackName: "PreProdApplicationStack",
        adminPermissions: true
    });

    // CodeDeploy to deploy production api
    const deployProd = new aws_codepipeline_actions.CloudFormationCreateUpdateStackAction({
    actionName: "DeployProdApplication",
    templatePath: cdkBuildOutput.atPath(
        "ProdApplicationStack.template.json"
    ),
    stackName: "ProdApplicationStack",
    adminPermissions: true
    });

      // pipeline
    const pipeline = new aws_codepipeline.Pipeline(this, "CicdPipelineDemo", {
      pipelineName: "CicdPipelineDemo",
      crossAccountKeys: false,
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Unittest",
          actions: [unitTestBuildAction],
        },
        {
          stageName: "BuildTemplate",
          actions: [cdkBuild],
        },
        {
          stageName: "DeployPreProd",
          actions: [deployPreProd],
        },
        {
          stageName: "IntegTest",
          actions: [integTestBuildAction],
        },
        {
          stageName: "DeployProd",
          actions: [deployProd],
        },
      ],
    });

    // Remove artifact bucket on stack delete
      pipeline.artifactBucket.applyRemovalPolicy(RemovalPolicy.DESTROY)
  }
}