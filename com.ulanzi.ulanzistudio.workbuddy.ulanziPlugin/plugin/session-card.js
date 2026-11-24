"use strict";

const {MODEL_CARD} = require("./model-art");
const {width, height} = MODEL_CARD;
const squareTop = (height - width) / 2;

/** Keep square status cards and approval menus at their existing size in the full dial canvas. */
function sessionCard(content, contentWidth = width) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}">
    <g transform="translate(0 ${squareTop}) scale(${width / contentWidth})">${content}</g>
  </svg>`;
}

module.exports = {sessionCard};
