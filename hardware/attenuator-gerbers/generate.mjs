import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("hardware/attenuator-gerbers/build");
fs.rmSync(outDir, { recursive: true, force: true });
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
const seriesResistors = rows.map((y, index) => ({
  designator: `R${index + 1}`,
  center: { x: 36, y },
  pads: [{ x: 35, y }, { x: 37, y }],
  rotation: 0,
}));
const shuntResistors = rows.map((y, index) => ({
  designator: `R${index + 5}`,
  center: { x: 53, y: y + 1 },
  pads: [{ x: 53, y }, { x: 53, y: y + 2 }],
  rotation: 90,
}));

function addTestPointPads(lines) {
  signalTestPoints.forEach((point) => flash(lines, 11, point));
  groundTestPoints.forEach((point) => flash(lines, 12, point));
}

const frontCopper = header("4-channel attenuator front copper", [
  "%ADD10C,0.500000*%",
  "%ADD11R,3.800000X3.800000*%",
  "%ADD12C,3.800000*%",
  "%ADD13R,1.200000X1.400000*%",
  "%ADD14R,1.400000X1.200000*%",
]);
addTestPointPads(frontCopper);
seriesResistors.flatMap(({ pads }) => pads).forEach((point) => flash(frontCopper, 13, point));
shuntResistors.flatMap(({ pads }) => pads).forEach((point) => flash(frontCopper, 14, point));
line(frontCopper, 10, inputSignal, { x: 20, y: inputSignal.y });
line(frontCopper, 10, { x: 20, y: rows[0] }, { x: 20, y: rows.at(-1) });
for (const y of rows) {
  line(frontCopper, 10, { x: 20, y }, { x: 35, y });
  line(frontCopper, 10, { x: 37, y }, { x: 68, y });
  line(frontCopper, 10, { x: 53, y: y + 2 }, { x: 76, y: y + 2 });
  line(frontCopper, 10, { x: 76, y: y + 2 }, { x: 76, y });
}
frontCopper.push("M02*");

const backCopper = header("4-channel attenuator back copper", [
  "%ADD10C,0.800000*%",
  "%ADD11R,3.800000X3.800000*%",
  "%ADD12C,3.800000*%",
]);
addTestPointPads(backCopper);
line(backCopper, 10, inputGround, { x: 15, y: 76 });
line(backCopper, 10, { x: 15, y: 76 }, { x: 76, y: 76 });
line(backCopper, 10, { x: 76, y: rows[0] }, { x: 76, y: 76 });
backCopper.push("M02*");

function frontMaskLayer() {
  const lines = header("4-channel attenuator front solder mask", [
    "%ADD10R,4.200000X4.200000*%",
    "%ADD11C,4.200000*%",
    "%ADD12R,1.400000X1.600000*%",
    "%ADD13R,1.600000X1.400000*%",
  ]);
  signalTestPoints.forEach((point) => flash(lines, 10, point));
  groundTestPoints.forEach((point) => flash(lines, 11, point));
  seriesResistors.flatMap(({ pads }) => pads).forEach((point) => flash(lines, 12, point));
  shuntResistors.flatMap(({ pads }) => pads).forEach((point) => flash(lines, 13, point));
  lines.push("M02*");
  return lines;
}

function backMaskLayer() {
  const lines = header("4-channel attenuator back solder mask", [
    "%ADD10R,4.200000X4.200000*%",
    "%ADD11C,4.200000*%",
  ]);
  signalTestPoints.forEach((point) => flash(lines, 10, point));
  groundTestPoints.forEach((point) => flash(lines, 11, point));
  lines.push("M02*");
  return lines;
}

function topPasteLayer() {
  const lines = header("4-channel attenuator top solder paste", [
    "%ADD10R,1.100000X1.300000*%",
    "%ADD11R,1.300000X1.100000*%",
  ]);
  seriesResistors.flatMap(({ pads }) => pads).forEach((point) => flash(lines, 10, point));
  shuntResistors.flatMap(({ pads }) => pads).forEach((point) => flash(lines, 11, point));
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
  rectangle(silk, 10, 34.5, y - 1.1, 37.5, y + 1.1);
  rectangle(silk, 10, 51.9, y - 0.5, 54.1, y + 2.5);
  text(silk, `OUT${index + 1}`, 58, y - 5.5, 0.55);
  text(silk, "G", 74.5, y - 5.5, 0.55);
  text(silk, `R${index + 1}`, 34, y - 4.5, 0.5);
  text(silk, `R${index + 5}`, 55.5, y + 0.2, 0.5);
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
  "%",
  "G90",
  "G05",
  "T1",
  ...[...signalTestPoints, ...groundTestPoints].map(
    (point) => `X${point.x.toFixed(3)}Y${point.y.toFixed(3)}`,
  ),
  "T0",
  "M30",
];

const files = {
  "attenuator.GTL": frontCopper,
  "attenuator.GBL": backCopper,
  "attenuator.GTS": frontMaskLayer(),
  "attenuator.GBS": backMaskLayer(),
  "attenuator.GTP": topPasteLayer(),
  "attenuator.GTO": silk,
  "attenuator.GKO": edges,
  "attenuator.XLN": drill,
};

for (const [name, lines] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), `${lines.join("\n")}\n`);
}

const assemblyDir = path.resolve("hardware/attenuator-gerbers/assembly");
fs.rmSync(assemblyDir, { recursive: true, force: true });
fs.mkdirSync(assemblyDir, { recursive: true });

const bom = [
  "Comment,Designator,Footprint,LCSC Part #,Manufacturer,Manufacturer Part Number",
  '100k ohm 0.1% 25ppm thin-film,"R1,R2,R3,R4",0805,C122537,YAGEO,RT0805BRD07100KL',
  '100 ohm 0.1% 25ppm thin-film,"R5,R6,R7,R8",0805,C515718,Viking,ARG05BTC1000',
  'Red multipurpose THM test point,"TP1,TP3,TP5,TP7,TP9",Keystone_5010,C2906765,Keystone,5010',
  'Black multipurpose THM test point,"TP2,TP4,TP6,TP8,TP10",Keystone_5011,C238127,Keystone,5011',
];

const placements = [
  { designator: "TP1", point: inputSignal, rotation: 0 },
  { designator: "TP2", point: inputGround, rotation: 0 },
  ...rows.flatMap((y, index) => [
    { designator: `TP${index * 2 + 3}`, point: { x: 68, y }, rotation: 0 },
    { designator: `TP${index * 2 + 4}`, point: { x: 76, y }, rotation: 0 },
  ]),
  ...seriesResistors.map(({ designator, center, rotation }) => ({
    designator,
    point: center,
    rotation,
  })),
  ...shuntResistors.map(({ designator, center, rotation }) => ({
    designator,
    point: center,
    rotation,
  })),
];
const cpl = [
  "Designator,Mid X,Mid Y,Layer,Rotation",
  ...placements.map(({ designator, point, rotation }) =>
    `${designator},${point.x.toFixed(3)}mm,${point.y.toFixed(3)}mm,Top,${rotation}`,
  ),
];

fs.writeFileSync(path.join(assemblyDir, "attenuator-bom.csv"), `${bom.join("\n")}\n`);
fs.writeFileSync(path.join(assemblyDir, "attenuator-cpl.csv"), `${cpl.join("\n")}\n`);

console.log(`Generated ${Object.keys(files).length} fabrication files plus BOM and CPL`);
