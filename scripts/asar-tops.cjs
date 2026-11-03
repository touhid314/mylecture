// Lists the top-level entries of the packaged app.asar (and a pattern's hits).
//   node scripts/asar-tops.cjs [regex]
const asar = require("@electron/asar");
const files = asar.listPackage("dist/win-unpacked/resources/app.asar").map((f) => f.replace(/\\/g, "/"));
console.log("top level:", [...new Set(files.map((f) => f.split("/")[1]))].join(" "));
if (process.argv[2]) console.log(files.filter((f) => new RegExp(process.argv[2], "i").test(f)));
