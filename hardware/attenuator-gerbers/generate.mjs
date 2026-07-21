import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("hardware/attenuator-gerbers/build");
fs.mkdirSync(outDir, { recursive: true });

const boardWidth = 80;
const boardHeight = 78;
const rows = [8, 25, 42, 59];
const inputSignal = { x: 5, y: 39 };
const inputGround = { x: 15, y: 39 };

const fmt = (value) => String(Math.round(value * 1_000_000)).padStart(10, "0");
const xy = ({ x, y }) => `X${fmt(x)}Y${fmt(y)}`;

function header(title, apertures) {
  return [
    `G04 ${title}*`,
    "%FSLAX46Y46*%",
    "%MOMM*%",
    "%IPPOS*%",
    "%LPD*%",
    ...apertures,
  ];
}

function line(lines, aperture, from, to) {
  lines.push(`D${aperture}*`, `${xy(from)}D02*`, `${xy(to)}D01*`);
}

function flash(lines, aperture, point) {
  lines.push(`D${aperture}*`, `${xy(point)}D03*`);
}

function rectangle(lines, aperture, x1, y1, x2, y2) {
  line(lines, aperture, { x: x1, y: y1 }, { x: x2, y: y1 });
  line(lines, aperture, { x: x2, y: y1 }, { x: x2, y: y2 });
  line(lines, aperture, { x: x2, y: y2 }, { x: x1, y: y2 });
  line(lines, aperture, { x: x1, y: y2 }, { x: x1, y: y1 });
}

const signalTestPoints = [
  inputSignal,
  ...rows.map((y) => ({ x: 68, y })),
];
const groundTestPoints = [
  inputGround,
  ...rows.map((y) => ({ x: 76, y })),
];
const seriesPads = rows.flatMap((y) => [
  { x: 28, y },
  { x: 43, y },
]);
const shuntPads = rows.flatMap((y) => [
  { x: 53, y },
  { x: 53, y: y + 15 },
]);
const resistorPads = [...seriesPads, ...shuntPads];

function addAllCopperPads(lines) {
  signalTestPoints.forEach((point) => flash(lines, 11, point));
  groundTestPoints.forEach((point) => flash(lines, 12, point));
  resistorPads.forEach((point) => flash(lines, 13, point));
}

const frontCopper = header("4-channel attenuator front copper", [
  "%ADD10C,0.500000*%",
  "%ADD11R,3.800000X3.800000*%",
  "%ADD12C,3.800000*%",
  "%ADD13C,2.200000*%",
]);
addAllCopperPads(frontCopper);
line(frontCopper, 10, inputSignal, { x: 20, y: inputSignal.y });
line(frontCopper, 10, { x: 20, y: rows[0] }, { x: 20, y: rows.at(-1) });
for (const y of rows) {
  line(frontCopper, 10, { x: 20, y }, { x: 28, y });
  line(frontCopper, 10, { x: 43, y }, { x: 68, y });
}
frontCopper.push("M02*");

const backCopper = header("4-channel attenuator back copper", [
  "%ADD10C,0.800000*%",
  "%ADD11R,3.800000X3.800000*%",
  "%ADD12C,3.800000*%",
  "%ADD13C,2.200000*%",
]);
addAllCopperPads(backCopper);
line(backCopper, 10, inputGround, { x: 15, y: 76 });
line(backCopper, 10, { x: 15, y: 76 }, { x: 76, y: 76 });
line(backCopper, 10, { x: 76, y: rows[0] }, { x: 76, y: 76 });
for (const y of rows) {
  line(backCopper, 10, { x: 53, y: y + 15 }, { x: 76, y: y + 15 });
}
backCopper.push("M02*");

function maskLayer(title) {
  const lines = header(title, [
    "%ADD10R,4.200000X4.200000*%",
    "%ADD11C,4.200000*%",
    "%ADD12C,2.600000*%",
  ]);
  signalTestPoints.forEach((point) => flash(lines, 10, point));
  groundTestPoints.forEach((point) => flash(lines, 11, point));
  resistorPads.forEach((point) => flash(lines, 12, point));
  lines.push("M02*");
  return lines;
}

const font = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  E: ["111", "100", "110", "100", "111"],
  G: ["111", "100", "101", "101", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  R: ["110", "101", "110", "101", "101"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  ":": ["000", "010", "000", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

function text(lines, value, x, y, scale = 0.65) {
  let cursor = x;
  for (const character of value) {
    const glyph = font[character] ?? font[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row][column] === "1") {
          flash(lines, 11, {
            x: cursor + column * scale,
            y: y + row * scale,
          });
        }
      }
    }
    cursor += 4 * scale;
  }
}

const silk = header("4-channel attenuator front silkscreen", [
  "%ADD10C,0.200000*%",
  "%ADD11C,0.450000*%",
]);
rectangle(silk, 10, 2.6, 36.6, 7.4, 41.4);
rectangle(silk, 10, 12.6, 36.6, 17.4, 41.4);
text(silk, "IN", 2.5, 31.5);
text(silk, "G", 14, 31.5);

rows.forEach((y, index) => {
  rectangle(silk, 10, 65.6, y - 2.4, 70.4, y + 2.4);
  rectangle(silk, 10, 73.6, y - 2.4, 78.4, y + 2.4);
  rectangle(silk, 10, 32, y - 1.6, 39, y + 1.6);
  rectangle(silk, 10, 51.4, y + 4, 54.6, y + 11);
  text(silk, `OUT${index + 1}`, 58, y - 5.5, 0.55);
  text(silk, "G", 74.5, y - 5.5, 0.55);
  text(silk, `R${index + 1}`, 34, y - 4.5, 0.5);
  text(silk, `R${index + 5}`, 55.5, y + 5, 0.5);
});
text(silk, "4CH 1001:1 ATTENUATOR", 10, 1.5, 0.55);
silk.push("M02*");

const edges = header("4-channel attenuator board outline", [
  "%ADD10C,0.150000*%",
]);
rectangle(edges, 10, 0, 0, boardWidth, boardHeight);
edges.push("M02*");

const drill = [
  "M48",
  "; 4-channel attenuator plated through holes",
  "FMAT,2",
  "METRIC,TZ",
  "T1C1.600",
  "T2C0.900",
  "%",
  "G90",
  "G05",
  "T1",
  ...[...signalTestPoints, ...groundTestPoints].map(
    (point) => `X${point.x.toFixed(3)}Y${point.y.toFixed(3)}`,
  ),
  "T2",
  ...resistorPads.map(
    (point) => `X${point.x.toFixed(3)}Y${point.y.toFixed(3)}`,
  ),
  "T0",
  "M30",
];

const files = {
  "attenuator-F_Cu.gbr": frontCopper,
  "attenuator-B_Cu.gbr": backCopper,
  "attenuator-F_Mask.gbr": maskLayer("4-channel attenuator front solder mask"),
  "attenuator-B_Mask.gbr": maskLayer("4-channel attenuator back solder mask"),
  "attenuator-F_Silkscreen.gbr": silk,
  "attenuator-Edge_Cuts.gbr": edges,
  "attenuator-PTH.drl": drill,
};

for (const [name, lines] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), `${lines.join("\n")}\n`);
}

console.log(`Generated ${Object.keys(files).length} fabrication files in ${outDir}`);
