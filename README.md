# aws-command-invoker

The aws-command-invoker script invokes a series of AWS commands, which are specified in the configuration file.

[Motivation and Approach](#Motivation-and-Approach)

[Prerequisites](#Prerequisites)

[Usage](#Usage)

[Configuration file](#Configuration-file)

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

If this configuration is saved to `example.json`, it can be run as follows:

    node aws-command-invoker.js ./example.json

### Log-test example

The `log-test-api.json` configuration file is an example of specifying AWS commands to create a new REST API that can be used to invoke a Lambda function called log-test.

In the invocation below, [dotenv](https://github.com/motdotla/dotenv) is used to set environment variables

    node -r dotenv/config aws-command-invoker.js ./log-test-api.json

## Configuration file

Configuration is defined as an object in a JSON file. It has two parts.

### apiVersions

The API versions of the AWS SDK classes are defined in this section. Refer to the AWS SDK documenation for each class for the appropriate parameter. For example:

    "apiVersions": {
        "apigateway": "2015-07-09",
        "lambda": "2015-03-31"
    }

### commands

The commands to be invoked are defined, in order, in this section. For each command, specify the following properties:

* `objectType` - the AWS SDK command class to be used
* `method` - the method to invoke
* `comment` - optional comment
* `resultsID` - an identifier for the results of the command; this allows result values to be used in subsequent commands by replacing parameter placeholders
* `params` - parameters for the command; these should match the documented parameters

For example:

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

#### expectedResults

Optionally, an `expectedResults` property can be included in a command's configuration. The specified properties will be compared with the results returned.

Comparison is fairly naive: each property value is converted to a String (using JSON.stringify) and compared for equality. Expected values must be specified to match stringified values from results.

    "expectedResults": {
      "status": 200,
      "body": "{\"test\":\"yes\"}"
    }

### Replacements

Command parameter values can be replaced with previous result values or environment variables. Replacement placeholders use the following syntax.

* `{ }` - replacements start and end with these characters
* `.` - identifiers for replacements from returned results are separated with this character
* `%` - replacements from environment variables are marked (start & end) with this character
* `[ ]` - replacements referencing array values start and end with these characters

For example:

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

### Environment variables

Environment variables can be specified as replacements in the configuration file

Also, if specified as an environment variable, the AWS region will be set. For example, `AWS_REGION=eu-west-2`

## Limitations

Limited error handling

Rudimentary results testing

## Dependencies

* [aws-sdk](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS.html)

## Authors

* **[spatialoperator](https://github.com/spatialoperator)**

## Licence

This project is licensed under the ISC Licence - see the [LICENCE.txt](LICENCE.txt) file for details
