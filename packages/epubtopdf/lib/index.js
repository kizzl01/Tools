// ./lib/index.js
const readline = require("readline");
const path = require("path");
const convert = require("ebook-convert");
/**
 * asks the user for specifying a parameter
 *
 * @param {parameter} String parameter to ask for
 */

async function gatherInfo(parameter) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(parameter, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}

async function getTaskParameters(filename) {
  let input;
  if (filename) {
    input = path.join(process.cwd(), filename);
  } else {
    input = await gatherInfo("Input File Path: ");
  }
  const output = path.join(
    path.parse(input).dir,
    `${path.basename(input, ".epub")}.pdf`
  );
  return {
    source: input,
    target: output,
  };
}

const epubToPdf = async function (filename) {
  const options = await getTaskParameters(filename);
  convert(options, function (err) {
    if (err) console.log(err);
  });
};

// Allows us to call this function from outside of the library file.
// Without this, the function would be private to this file.
exports.epubToPdf = epubToPdf;
