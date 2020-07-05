# aws-command-invoker

The aws-command-invoker script invokes a series of AWS commands, which are specified in the configuration file.

[Motivation and Approach](#Motivation-and-Approach)

[Prerequisites](#Prerequisites)

[Usage](#Usage)

[Configuration file](#Configuration-file)

[Example configuration file](#Example-configuration-file)

[Limitations](#Limitations)

[Dependencies](#Dependencies)

## Motivation and Approach

AWS Command Invoker (ACI) is a lightweight Node.js script that enables automated AWS deployment and configuration. While there are already a range of tools that cater for this, such as the [AWS Serverless Application Model (SAM)](https://aws.amazon.com/serverless/sam/) or use of the [AWS Command Line Interface (CLI)](https://aws.amazon.com/cli/) via shell scripting, ACI is intended to be less opinionated and OS specific than either of these.

The approach of ACI is to invoke a sequence of [AWS SDK for JavaScript (Node.js)](https://aws.amazon.com/sdk-for-node-js/) commands that are defined in a JSON configuration file. The results of each command are available to subsequent commands, and command parameters can be replaced with previous result values or environment variables. This means, for example, that it's possible to [create a new REST API](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/APIGateway.html#createRestApi-property) and configure it using the API's identifier, which is created and returned as a result of the first operation.

## Prerequisites

Requires Node.js (tested with version 12.18.0), the [AWS SDK for JavaScript in Node.js](https://aws.amazon.com/sdk-for-node-js/) and AWS credentials (ref. [Loading Credentials in Node.js from the Shared Credentials File](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html)) to be in place.

**NB:** make sure that the AWS region has been specified (ref. 'Using an Environment Variable' and 'Using a Shared Config File' in [Setting the AWS Region](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-region.html))

## Usage

### Simple example

Start by specifying the AWS commands to be invoked. For example, the following configuration will list current REST APIs.

```json
{
  "apiVersions": {
    "apigateway": "2015-07-09"
  },
  "commands": [
    {
      "objectType": "APIGateway",
      "method": "getRestApis",
      "comment": "Lists RestApi resources",
      "resultsID": "getRestApisResults",
      "params": {
        "limit": 12
      }
    }
  ]
}
```

If this configuration is saved to `example.json`, it can be run as follows:

    node aws-command-invoker.js ./example.json

### Log-test example

The `log-test-api.json` configuration file (see [example configuration file](#Example-configuration-file)) is an example of specifying AWS commands to create a new REST API that can be used to invoke a Lambda function called log-test.

In the invocation below, [dotenv](https://github.com/motdotla/dotenv) is used to set environment variables

    node -r dotenv/config aws-command-invoker.js ./log-test-api.json

## Configuration file

Configuration is defined as an object in a JSON file, which has two parts. (See below for an [example configuration file](#Example-configuration-file).)

### apiVersions

The API versions of the AWS SDK classes are defined in this section. Refer to the AWS SDK documenation for each class for the appropriate parameter. For example:

```json
"apiVersions": {
    "apigateway": "2015-07-09",
    "lambda": "2015-03-31"
}
```

### commands

The commands to be invoked are defined, in order, in this section. For each command, specify the following properties:

* `objectType` - the AWS SDK command class to be used
* `method` - the method to invoke
* `comment` - optional comment
* `resultsID` - an identifier for the results of the command; this allows result values to be used in subsequent commands by replacing parameter placeholders
* `params` - parameters for the command; these should match the documented parameters

For example:

```json
"commands": [
    {
      "objectType": "APIGateway",
      "method": "createRestApi",
      "comment": "Create REST API",
      "resultsID": "createRestApiResults",
      "params": {
        "name": "log-test-API",
        "description": "log-test-API"
      }
    }
  ]
```

#### expectedResults

Optionally, an `expectedResults` property can be included in a command's configuration. The specified properties will be compared with the results returned.

Comparison is fairly naive: each property value is converted to a String (using JSON.stringify) and compared for equality. Expected values must be specified to match stringified values from results.

```json
"expectedResults": {
  "status": 200,
  "body": "{\"test\":\"yes\"}"
}
```

### Replacements

Command parameter values can be replaced with previous result values or environment variables. Replacement placeholders use the following syntax.

* `{ }` - replacements start and end with these characters
* `.` - identifiers for replacements from returned results are separated with this character
* `%` - replacements from environment variables are marked (start & end) with this character
* `[ ]` - replacements referencing array values start and end with these characters
* `< >` - list of files to zip starts and ends with these characters
* `|` - individual files to zip are separated with this character

For example:

```json
{
  "objectType": "APIGateway",
  "method": "createResource",
  "comment": "Create resource, using parent ID returned for the root resource",
  "resultsID": "createResourceResults",
  "params": {
    "pathPart": "%API_NAME%-resource",
    "parentId": "{getResourcesResults.items[0].id}",
    "restApiId": "{createRestApiResults.id}"
  }
}
```

### Environment variables

Environment variables can be specified as replacements in the configuration file

Also, if specified as an environment variable, the AWS region will be set. For example, `AWS_REGION=eu-west-2`

### Files to zip

If a Zip file is required as a parameter, a list of files to zip can be provided. For example, the following configuration creates a new Lambda function, supplying the code using the Zip file mechanism.

```json
{
  "apiVersions": {
    "lambda": "2015-03-31"
  },
  "commands": [
    {
      "objectType": "Lambda",
      "method": "createFunction",
      "comment": "Create Lambda function",
      "resultsID": "createFunctionResults",
      "params": {
        "FunctionName": "log-test",
        "Code": {
          "ZipFile": "<{%ZIP_SOURCE_01%}>"
        },
        "Handler": "log-test.lambdaHandler",
        "Role": "arn:aws:iam::{%AWS_ACCOUNT_ID%}:role/lambda_basic_execution",
        "Runtime": "nodejs12.x",
        "Description": "log-test",
        "Environment": {
          "Variables": {
            "LOG_LEVEL": "info"
          }
        },
        "Layers": [
          "arn:aws:lambda:{%AWS_REGION%}:{%AWS_ACCOUNT_ID%}:layer:{%LAYER_NAME%}:{%LAYER_VERSION%}"
        ],
        "Publish": true
      }
    }
  ]
}
```

The following configuration updates the code for the Lambda function created in the example above, again using the Zip file mechanism. In this example, multiple source files are specified.

```json
{
  "apiVersions": {
    "lambda": "2015-03-31"
  },
  "commands": [
    {
      "objectType": "Lambda",
      "method": "updateFunctionCode",
      "comment": "Update Lambda function code",
      "resultsID": "updateFunctionCodeResults",
      "params": {
        "FunctionName": "log-test",
        "ZipFile": "<{%ZIP_SOURCE_01%}|{%ZIP_SOURCE_02%}>"
      }
    }
  ]
}
```

## Example configuration file

This example configuration file creates a REST API that integrates with an existing Lambda function. This is done by carrying out the following steps:

* Create a new REST API
* Get the root resource of the API to determine its ID
* Create a resource, using the parent ID returned for the root resource
* Create an integration with the Lambda function
* Create an integration response
* Grant permission to invoke the Lambda function
* Create a deployment of the API
* Test the invocation of the Lambda function via the API

```json
{
  "apiVersions": {
      "apigateway": "2015-07-09",
      "lambda": "2015-03-31"
  },
  "commands": [
    {
      "objectType": "APIGateway",
      "method": "createRestApi",
      "comment": "Create REST API",
      "resultsID": "createRestApiResults",
      "params": {
        "name": "log-test-API",
        "description": "log-test-API"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "getResources",
      "comment": "Get root resource to determine its ID",
      "resultsID": "getResourcesResults",
      "params": {
        "restApiId": "{createRestApiResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "createResource",
      "comment": "Create resource, using parent ID returned for the root resource",
      "resultsID": "createResourceResults",
      "params": {
        "pathPart": "log-test-resource",
        "parentId": "{getResourcesResults.items[0].id}",
        "restApiId": "{createRestApiResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "putMethod",
      "comment": "Create method",
      "resultsID": "putMethodResults",
      "params": {
        "operationName": "log-test-method",
        "httpMethod": "ANY",
        "authorizationType": "NONE",
        "apiKeyRequired": false,
        "restApiId": "{createRestApiResults.id}",
        "resourceId": "{createResourceResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "putIntegration",
      "comment": "Create integration",
      "resultsID": "putIntegrationResults",
      "params": {
        "httpMethod": "ANY",
        "type": "AWS_PROXY",
        "integrationHttpMethod": "POST",
        "passthroughBehavior": "WHEN_NO_MATCH",
        "contentHandling": "CONVERT_TO_TEXT",
        "timeoutInMillis": 29000,
        "uri": "arn:aws:apigateway:{%AWS_REGION%}:lambda:path/2015-03-31/functions/arn:aws:lambda:{%AWS_REGION%}:{%AWS_ACCOUNT_ID%}:function:log-test/invocations",
        "restApiId": "{createRestApiResults.id}",
        "resourceId": "{createResourceResults.id}",
        "cacheNamespace": "{createResourceResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "putIntegrationResponse",
      "comment": "Create integration response",
      "resultsID": "putIntegrationResponse",
      "params": {
        "httpMethod": "ANY",
        "statusCode": "200",
        "responseTemplates": {
          "application/json": null
        },
        "restApiId": "{createRestApiResults.id}",
        "resourceId": "{createResourceResults.id}"
      }
    },
    {
      "objectType": "Lambda",
      "method": "addPermission",
      "comment": "Grant API permission to invoke Lambda",
      "resultsID": "addPermissionResults",
      "params": {
        "Action": "lambda:InvokeFunction",
        "FunctionName": "log-test",
        "Principal": "apigateway.amazonaws.com",
        "SourceArn": "arn:aws:execute-api:{%AWS_REGION%}:{%AWS_ACCOUNT_ID%}:{createRestApiResults.id}/*/*/log-test-resource",
        "StatementId": "log-test-{createRestApiResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "createDeployment",
      "comment": "Create deployment",
      "resultsID": "createDeploymentResults",
      "params": {
        "stageName": "alpha",
        "stageDescription": "Alpha stage",
        "description": "Deployment to alpha stage",
        "restApiId": "{createRestApiResults.id}"
      }
    },
    {
      "objectType": "APIGateway",
      "method": "testInvokeMethod",
      "comment": "Test the method invocation",
      "resultsID": "testInvokeMethodResults",
      "params": {
        "httpMethod": "GET",
        "restApiId": "{createRestApiResults.id}",
        "resourceId": "{createResourceResults.id}",
        "pathWithQueryString": "https://{createRestApiResults.id}.execute-api.{%AWS_REGION%}.amazonaws.com/alpha/log-test-resource?test=yes"
      },
      "expectedResults": {
        "status": 200,
        "body": "{\"test\":\"yes\"}"
      }
    }
  ]
}
```

## Limitations

Limited error handling

Rudimentary results testing

Files to zip are buffered in memory. For large volumes, consider handling Zip file separately

## Dependencies

* [aws-sdk](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS.html)

* [adm-zip](https://github.com/cthackers/adm-zip)

## Authors

* **[spatialoperator](https://github.com/spatialoperator)**

## Licence

This project is licensed under the ISC Licence - see the [LICENCE.txt](LICENCE.txt) file for details
