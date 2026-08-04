const COLUMN_COUNT = 10;

export function reconstructLines(textObjects) {
  const sorted = [...textObjects].sort((left, right) =>
    right.baseline - left.baseline || left.boundingBox.xMin - right.boundingBox.xMin || left.source.objectIndex - right.source.objectIndex
  );
  const lines = [];

  for (const textObject of sorted) {
    const tolerance = Math.max(2, textObject.font.size * 0.35);
    const line = lines.find(candidate => Math.abs(candidate.baseline - textObject.baseline) <= tolerance);
    if (line) {
      line.textObjects.push(textObject);
      line.baseline = Math.max(line.baseline, textObject.baseline);
    } else {
      lines.push({ baseline: textObject.baseline, textObjects: [textObject] });
    }
  }

  return lines
    .sort((left, right) => right.baseline - left.baseline)
    .map((line, index) => createLine(line, index));
}

function createLine(line, index) {
  const textObjects = line.textObjects.sort((left, right) =>
    left.boundingBox.xMin - right.boundingBox.xMin || left.source.objectIndex - right.source.objectIndex
  );
  const boundingBox = combineBoundingBoxes(textObjects.map(object => object.boundingBox));

  return {
    index,
    text: joinTextObjects(textObjects),
    baseline: line.baseline,
    boundingBox,
    textObjects,
    source: {
      pageNumber: textObjects[0]?.source.pageNumber ?? 0,
      lineIndex: index,
      originalText: textObjects.map(object => object.text).join('')
    }
  };
}

function joinTextObjects(textObjects) {
  return textObjects.reduce((text, object, index) => {
    if (index === 0) return object.text;
    const previous = textObjects[index - 1];
    const gap = object.boundingBox.xMin - previous.boundingBox.xMax;
    return text + (gap > Math.max(1.5, previous.font.size * 0.15) ? ' ' : '') + object.text;
  }, '');
}

export function reconstructTablesAndBlocks(lines, pageNumber, pageBox) {
  const headerLines = findGeometricHeaders(lines);
  const tables = headerLines.map((headerLine, tableIndex) => {
    const nextHeader = headerLines[tableIndex + 1];
    const endLineIndex = nextHeader ? nextHeader.index - 1 : lines.length - 1;
    const columns = createColumns(headerLine, pageBox);
    const tableLines = lines.slice(headerLine.index, endLineIndex + 1);
    const cells = assignCells(tableLines, columns, pageNumber, tableIndex);

    return {
      index: tableIndex,
      headerLineIndex: headerLine.index,
      lineRange: { start: headerLine.index, end: endLineIndex },
      boundingBox: combineBoundingBoxes(tableLines.map(line => line.boundingBox)),
      columns,
      cells,
      source: { pageNumber, headerLineIndex: headerLine.index }
    };
  });

  return {
    tables,
    serviceBlocks: tables.map((table, index) => ({
      index,
      lineRange: table.lineRange,
      boundingBox: table.boundingBox,
      tableIndex: table.index,
      source: {
        pageNumber,
        startLineIndex: table.lineRange.start,
        endLineIndex: table.lineRange.end
      }
    }))
  };
}

function findGeometricHeaders(lines) {
  const candidates = lines.filter(line => {
    const nonEmptyObjects = line.textObjects.filter(object => object.text.trim());
    const xSpread = line.boundingBox.xMax - line.boundingBox.xMin;
    return nonEmptyObjects.length >= COLUMN_COUNT && xSpread > 400;
  });

  return candidates.filter(candidate => {
    const candidateAnchors = anchorPositions(candidate);
    return candidates.filter(other => anchorSimilarity(candidateAnchors, anchorPositions(other)) >= 0.8).length >= 2;
  });
}

function anchorPositions(line) {
  return line.textObjects
    .filter(object => object.text.trim())
    .map(object => object.boundingBox.xMin)
    .sort((left, right) => left - right)
    .slice(0, COLUMN_COUNT);
}

function anchorSimilarity(left, right) {
  if (left.length < COLUMN_COUNT || right.length < COLUMN_COUNT) return 0;
  const matches = left.filter((position, index) => Math.abs(position - right[index]) <= 5).length;
  return matches / COLUMN_COUNT;
}

function createColumns(headerLine, pageBox) {
  const anchors = anchorPositions(headerLine);
  return anchors.map((anchor, index) => {
    const xMin = index === 0 ? pageBox.xMin : (anchors[index - 1] + anchor) / 2;
    const xMax = index === anchors.length - 1 ? pageBox.xMax : (anchor + anchors[index + 1]) / 2;
    return {
      index,
      label: `Spalte ${index + 1}`,
      boundingBox: { xMin, yMin: pageBox.yMin, xMax, yMax: pageBox.yMax },
      source: { pageNumber: headerLine.source.pageNumber, headerLineIndex: headerLine.index, anchorX: anchor }
    };
  });
}

function assignCells(lines, columns, pageNumber, tableIndex) {
  const cells = [];
  for (const line of lines) {
    const grouped = columns.map(column => ({ column, textObjects: [] }));
    for (const textObject of line.textObjects) {
      const center = (textObject.boundingBox.xMin + textObject.boundingBox.xMax) / 2;
      const target = grouped.find(group => center >= group.column.boundingBox.xMin && center <= group.column.boundingBox.xMax)
        ?? grouped.reduce((nearest, group) => Math.abs(center - group.column.source.anchorX) < Math.abs(center - nearest.column.source.anchorX) ? group : nearest);
      target.textObjects.push(textObject);
    }
    for (const group of grouped) {
      if (!group.textObjects.length) continue;
      cells.push({
        rowIndex: line.index,
        columnIndex: group.column.index,
        text: joinTextObjects(group.textObjects),
        boundingBox: combineBoundingBoxes(group.textObjects.map(object => object.boundingBox)),
        textObjects: group.textObjects,
        source: {
          pageNumber,
          tableIndex,
          lineIndex: line.index,
          columnIndex: group.column.index,
          originalText: group.textObjects.map(object => object.text).join('')
        }
      });
    }
  }
  return cells;
}

export function combineBoundingBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return {
    xMin: Math.min(...valid.map(box => box.xMin)),
    yMin: Math.min(...valid.map(box => box.yMin)),
    xMax: Math.max(...valid.map(box => box.xMax)),
    yMax: Math.max(...valid.map(box => box.yMax))
  };
}
