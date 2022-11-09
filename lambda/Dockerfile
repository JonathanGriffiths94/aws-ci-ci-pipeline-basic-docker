FROM public.ecr.aws/lambda/python:3.8

# Copy function code
COPY src/app.py ${LAMBDA_TASK_ROOT}
#COPY tools/ ${LAMBDA_TASK_ROOT}/tools

# Install the function's dependencies using file requirements.txt
# from project folder.

COPY requirements.txt  .
RUN  pip3 install -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

# Add lambda RIE
WORKDIR ${LAMBDA_TASK_ROOT}
#ADD https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie /usr/bin/aws-lambda-rie
#RUN yum autoremove -y git build-essential ca-certificates
#RUN chmod 755 /usr/bin/aws-lambda-rie /home/app/entry.sh

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "app.handler" ]
