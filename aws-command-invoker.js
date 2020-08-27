'use strict'

const fs = require('fs');
const AWS = require('aws-sdk');
const AdmZip = require('adm-zip');

// Replacements start and end with these characters
const REP_START = "{";
const REP_END = "}";
// Marker to indicate that preceding replacement start character should be unescaped
const UNESCAPE_MARKER = "!";
// Identifiers for replacements from returned results are separated with this character
const REP_SEPARATOR = ".";
// Replacements from environment variables are marked (start & end) with this character
const ENV_MARKER = "%";
// Replacements referencing array values start and end with these characters
const ARR_MARKER_START = "[";
const ARR_MARKER_END = "]";
// Array value replacements are identified (and separated) with this character
const ARR_VALUE_MARKER = "$";
// Replacements for Zip files start and end with these characters, and are separated with this character
const ZIP_FILE_EXTENSION = ".zip"; // NB: keep as lowercase for comparison
const ZIP_MARKER_START = "<";
const ZIP_MARKER_END = ">";
const ZIP_SEPARATOR = "|";

/**
 * Replaces parameter values in the given propertyVal with result values from previous commands or environment variables.
 * @param {String} propertyVal - parameter values will be updated
 * @param {Object} apiResults - results from previous commands
 * @returns {String} updated propertyVal
 */
function replaceInlineParams(propertyVal, apiResults) {
  // Replace any environment variables
  propertyVal = replaceEnvVars(propertyVal);

  let endIndex, startIndex = propertyVal.indexOf(REP_START, 0);
  while (startIndex > -1) {
    // Check for UNESCAPE_MARKER, if found replace and move on
    // TODO: test with REP_START as last char in a propertyVal value
    if (propertyVal[startIndex + 1] === UNESCAPE_MARKER) {
      propertyVal = propertyVal.replace(UNESCAPE_MARKER, "");
      // TODO: guard against this being -1
      startIndex = propertyVal.indexOf(REP_START, startIndex + 1);
    } else {
      endIndex = propertyVal.indexOf(REP_END, startIndex);
      let repTarget = propertyVal.substring(startIndex + 1, endIndex);
      let repVal = null;

      // Check whether to replace using value from returned array
      let arrMarkerStart = repTarget.indexOf(ARR_MARKER_START);
      if (arrMarkerStart < 0) {
        let repParts = repTarget.split(REP_SEPARATOR);
        repVal = apiResults[repParts[0]][repParts[1]];
      } else {
        let sourceParts = repTarget.substring(0, arrMarkerStart).split(REP_SEPARATOR);
        let arrMarkerEnd = repTarget.indexOf(ARR_MARKER_END);
        let prop = repTarget.substring(arrMarkerEnd + 2);
        let indexVal = -1;
        // Check for ARR_VALUE_MARKER
        if (repTarget.indexOf(ARR_VALUE_MARKER) < 0) {
          indexVal = repTarget.substring(arrMarkerStart + 1, arrMarkerEnd);
        } else {
          let repTargetParts = repTarget.split(ARR_VALUE_MARKER);
          // TODO: check for -1 (i.e. not found)
          indexVal = locateIndexByKeyValue(apiResults[sourceParts[0]][sourceParts[1]], repTargetParts[1], repTargetParts[2]);
        }
        repVal = apiResults[sourceParts[0]][sourceParts[1]][Number.parseInt(indexVal)][prop];
      }

      // TODO: check that repVal has been found / populated (e.g. missing env var)
      // TODO: in theory, could swap a lot of this for the regex version of replace
      propertyVal = propertyVal.replace(REP_START + repTarget + REP_END, repVal);
      startIndex = propertyVal.indexOf(REP_START, (startIndex + repVal.length));
    }
  }

  return propertyVal;
}

/**
 * Replaces any environment variables in the given target String. Environment variables
 * must be contained within ENV_MARKER characters and fall between REP_START and REP_END
 * characters. If only the environment variable falls between the REP_START and REP_END
 * characters, these will be removed too.
 * @param {String} target - the target String
 * @returns {String} target String with any replacements made
 */
function replaceEnvVars(target) {
  let repStartIndex = target.indexOf(REP_START);
  let envTarget, envEndIndex, envStartIndex;
  while (repStartIndex >= 0) {
    // Check that REP_START wasn't escaped
    if (target.indexOf(UNESCAPE_MARKER, repStartIndex) != (repStartIndex + 1)) {
      envStartIndex = target.indexOf(ENV_MARKER);
      while (envStartIndex >= 0) {
        envEndIndex = target.indexOf(ENV_MARKER, envStartIndex + 1);
        envTarget = target.substring(envStartIndex + 1, envEndIndex);

        // Check whether the environment variable was on its own
        if (target.indexOf(REP_START + ENV_MARKER + envTarget + ENV_MARKER + REP_END) >= 0) {
          target = target.replace(REP_START + ENV_MARKER + envTarget + ENV_MARKER + REP_END, process.env[envTarget]);
        } else {
          target = target.replace(ENV_MARKER + envTarget + ENV_MARKER, process.env[envTarget]);
        }

        envStartIndex = target.indexOf(ENV_MARKER);
      }
    }
    repStartIndex = target.indexOf(REP_START, repStartIndex + 1);
  }

  return target;
}

/**
 * Returns the index of an array item by matching against the given key and value.
 * NB: will only search first level properties.
 * @param {Array} items - the Object array to search
 * @param {String} key - the property name
 * @param {String} value - the property value
 */
function locateIndexByKeyValue(items, key, value) {
  let index = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i][key] === value) {
      index = i;
      break;
    }
  }
  return index;
}

/**
 * Replaces parameter values in the given apiCommand with result values from previous commands or environment variables.
 * @param {Object} params - params - parameter values will be updated
 * @param {Object} apiResults - results from previous commands
 */
function replaceParams(params, apiResults) {
  let propertyVal = null;
  for (const property in params) {
    propertyVal = params[property];

    // Check for Object or Array parameters (& guard for null); recurse to replace within these
    if ((propertyVal !== null) && (typeof propertyVal === "object")) {
      replaceParams(propertyVal, apiResults);
    }

    // Check string parameters for any replacements
    if (typeof propertyVal === "string") {
      propertyVal = replaceInlineParams(propertyVal, apiResults);
      propertyVal = replaceZipFilesAsBuffer(propertyVal);
      params[property] = propertyVal;
    }
  }
}

/**
 * Make any replacements to provide a Zip file as a buffer.
 * @param {String} propertyVal - API command property value
 * @returns {Object} Buffered Zip file
 */
function replaceZipFilesAsBuffer(propertyVal) {
  // Check for Zip file markers
  let startIndex = propertyVal.indexOf(ZIP_MARKER_START, 0);
  if (startIndex > -1) {
    let endIndex = propertyVal.indexOf(ZIP_MARKER_END, startIndex);
    let zipFiles = propertyVal.substring(startIndex + 1, endIndex).split(ZIP_SEPARATOR);

    try {
      // Check for Zip file as argument
      if (zipFiles[0].toLowerCase().endsWith(ZIP_FILE_EXTENSION)) {
        propertyVal = fs.readFileSync(zipFiles[0]);
      } else {
        let zip = new AdmZip();
        for (let i = 0; i < zipFiles.length; i++) {
          zip.addLocalFile(zipFiles[i]);
          propertyVal = zip.toBuffer();
        }
      }
    } catch (error) {
      console.error("replaceZipFilesAsBuffer - error: %s", error);
      throw error;
    }
  }
  return propertyVal;
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
 * @param {Object[]} commands
 * @returns {Boolean} success
 */
async function invokeCommands(commands) {
  let apiResults = {};  // Used to store results of each API command, uses resultsID property as key
  let success = false;
  for (let i = 0; i < commands.length; i++) {
    let apiCommand = commands[i];
    replaceParams(apiCommand.params, apiResults);
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
console.log(process.cwd());
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
