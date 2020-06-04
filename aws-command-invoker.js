'use strict'

const AWS = require('aws-sdk');

// Replacements start and end with these characters
const REP_START = "{";
const REP_END = "}";
// Identifiers for replacements from returned results are separated with this character
const REP_SEPARATOR = ".";
// Replacements from environment variables are marked (start & end) with this character
const ENV_MARKER = "%";
// Replacements referencing array values start and end with these characters
const ARR_MARKER_START = "[";
const ARR_MARKER_END = "]";

/**
 * Replaces parameter values in the given apiCommand with result values from previous commands or environment variables.
 * @param {Object} apiCommand - apiCommand - parameter values will be updated
 * @param {Object} apiResults - results from previous commands
 */
function replaceParams(apiCommand, apiResults) {
  let params = apiCommand.params;
  let startIndex, endIndex;
  let propertyVal = null;
  for (const property in params) {
    propertyVal = params[property];
    // Check string parameters for any replacements
    if (typeof propertyVal === "string") {
      startIndex = propertyVal.indexOf(REP_START, 0);
      while (startIndex > -1) {
        endIndex = propertyVal.indexOf(REP_END, startIndex);  
        let repTarget = propertyVal.substring(startIndex + 1, endIndex);
        let repVal = null;

        // Check whether to replace from environment variables or returned results
        if (repTarget.indexOf(ENV_MARKER) === 0) {
          let envTarget = repTarget.substring(1, repTarget.length - 1);
          repVal = process.env[envTarget];
        } else {
          // Check whether to replace using value from returned array
          let arrMarkerStart = repTarget.indexOf(ARR_MARKER_START);
          if (arrMarkerStart < 0) {
            let repParts = repTarget.split(REP_SEPARATOR);  
            repVal = apiResults[repParts[0]][repParts[1]];  
          } else {
            let sourceParts = repTarget.substring(0, arrMarkerStart).split(REP_SEPARATOR);
            let arrMarkerEnd = repTarget.indexOf(ARR_MARKER_END);
            let indexVal = repTarget.substring(arrMarkerStart + 1, arrMarkerEnd);
            let prop = repTarget.substring(arrMarkerEnd + 2);
            repVal = apiResults[sourceParts[0]][sourceParts[1]][Number.parseInt(indexVal)][prop];
          }
        }
  
        // TODO: in theory, could swap a lot of this for the regex version of replace
        propertyVal = propertyVal.replace(REP_START + repTarget + REP_END, repVal);
        startIndex = propertyVal.indexOf(REP_START, (startIndex + repVal.length));
      }
      apiCommand.params[property] = propertyVal;  
    }
  }
}

/**
 * Invokes the given apiCommand; returns as a Promise
 * @param {Object} apiCommand 
 * @returns {Promise} resolves when apiCommand completes
 */
function invokeAPI(apiCommand) {
  return new Promise((resolve, reject) => {
    let instance = new AWS[apiCommand.objectType]();
    let request = instance[apiCommand.method](apiCommand.params);
    let result = request.promise();
    result.then((results) => {
      resolve(results);
    }).catch((err) => {
      reject(err);
    });
  });
}

/**
 * Checks the given returned results with the expected results specified in the given apiCommand.
 * Comparison is fairly naive: each property value is converted to a String (using JSON.stringify) and
 * compared for equality. Expected values must be specified to match stringified values from results.
 * @param {Object} apiCommand 
 * @param {Object} returnedResults 
 * @returns {Boolean} returns true if returned results are as expected
 */
function checkResults(apiCommand, returnedResults) {
  let resultsOk = true;
  if (apiCommand.expectedResults) {
    let expectedResults = apiCommand.expectedResults;
    let expectedResult, returnedResult;
    for (const property in expectedResults) {
      returnedResult = JSON.stringify(returnedResults[property]);
      expectedResult = JSON.stringify(expectedResults[property]);
      resultsOk = resultsOk && (returnedResult === expectedResult);
    }
  }
  return resultsOk;
}

/**
 * Invokes the given commands
 * @param {*} commands 
 */
async function invokeCommands(commands) {
  let apiResults = {};  // Used to store results of each API command, uses resultsID property as key
  let success = false;
  for (let i = 0; i < commands.length; i++) {
    let apiCommand = commands[i];
    replaceParams(apiCommand, apiResults);
    console.log(apiCommand);
    success = false;
    await invokeAPI(apiCommand).
    then((results) => {
      console.log(results);
      apiResults[apiCommand.resultsID] = results;
      success = checkResults(apiCommand, results);
      if (!success) {
        throw new Error("API command results not as expected");
      }
    }).
    catch((err) => {
      i = commands.length;
      console.error(err);
      success = false;
    });
  }
  return success;
}

// Determine the configuration file to use
const configFile = process.argv[2];
if (configFile === undefined) {
  console.error("Please specify configuration file");
  process.exit(1);
}

const apiCommands = require(configFile);
// Set API versions and AWS region (if set in environment)
AWS.config.apiVersions = apiCommands.apiVersions;
if (process.env.AWS_REGION !== undefined) {
  AWS.config.region = process.env.AWS_REGION;
}

invokeCommands(apiCommands.commands).then((result) => {
  console.log("success: %s", result);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
