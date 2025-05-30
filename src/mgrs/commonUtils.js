define([
  '../src/mgrs/mgrs.js'
], function (mgrs) {
  
  const SW_INDEX = 0;
  const NW_INDEX = 1;
  const NE_INDEX = 2;

  const LONGITUDE_INDEX = 0;
  const LATITUDE_INDEX = 1;

  const TEN_K_MGRS_REGEX = /([0-9]+[A-Z])([A-Z]{2})([0-9]{2})/;
  const GZD_INDEX = 1;

  const latBands = 'CDEFGHJKLMNPQRSTUVWX';

  function getLineSlope(pointOne, pointTwo) {
    if (pointOne === pointTwo) {
      return 0;
    } else if (pointOne.lng === pointTwo.lng) {
      return NaN;
    } else {
      return (pointTwo.lat - pointOne.lat) / (pointTwo.lng - pointOne.lng);
    }
  }

  function getAdjustedLatitude(slope, adjustedLongitude, unadjustedLatLong) {
    let result;
    if (!isNaN(slope)) {
      result = unadjustedLatLong.lat + slope * (adjustedLongitude - unadjustedLatLong.lng);
    } else {
      result = unadjustedLatLong.lat;
    }

    return result;
  }

  function getAdjustedLongitude(slope, adjustedLatitude, unadjustedLatLong) {
    let result;
    if (slope === 0) {
      const e = new Error('getAdjustedLongitude: Zero slope received');
      throw e;
    } else if (!isNaN(slope)) {
      result = (adjustedLatitude - unadjustedLatLong.lat + slope * unadjustedLatLong.lng) / slope;
    } else {
      result = unadjustedLatLong.lng;
    }

    return result;
  }

  function getNextMgrsGzdCharacter(char) {
    // I and O are not valid characters for MGRS, so get the next
    // character recursively
    const result = String.fromCharCode(char.charCodeAt(0) + 1);
    if (result === 'I' || result === 'O') {
      return getNextMgrsGzdCharacter(result);
    } else {
      return result;
    }
  }


  function connectToGzdBoundary(pointOne, pointTwo, direction) {
    const slope = getLineSlope(pointOne, pointTwo);
    // 10k mgrs resolution grid - e.g. 18TVR90
    const grid = mgrs.forward([pointOne.lng, pointOne.lat], 1);
    let adjustedLongitude;
    let adjustedLatitude;

    switch (direction) {
      case 'East':
        const gzdEastLongitude = getGzd(grid.match(TEN_K_MGRS_REGEX)[GZD_INDEX])[NE_INDEX][LONGITUDE_INDEX];

        adjustedLatitude = getAdjustedLatitude(slope, gzdEastLongitude, pointTwo);
        adjustedLongitude = gzdEastLongitude;

        return { lat: adjustedLatitude, lng: adjustedLongitude };

      case 'West':
        const gzdWestLongitude = getGzd(grid.match(TEN_K_MGRS_REGEX)[GZD_INDEX])[NW_INDEX][LONGITUDE_INDEX];

        adjustedLatitude = getAdjustedLatitude(slope, gzdWestLongitude, pointTwo);

        adjustedLongitude = gzdWestLongitude;
        return { lat: adjustedLatitude, lng: adjustedLongitude };
      case 'North':
        const gzdNorthLatitude = getGzd(grid.match(TEN_K_MGRS_REGEX)[GZD_INDEX])[NW_INDEX][LATITUDE_INDEX];

        adjustedLongitude = getAdjustedLongitude(slope, gzdNorthLatitude, pointTwo);

        // Handle a special case where the west most 100k easting line in the 32V GZD extends
        // west of the boundary
        const WEST_LNG_32V_BOUNDARY = 3;
        if (
          grid.match(TEN_K_MGRS_REGEX)[GZD_INDEX] === '31V' &&
          adjustedLongitude < WEST_LNG_32V_BOUNDARY &&
          pointTwo.lng > WEST_LNG_32V_BOUNDARY
        ) {
          adjustedLatitude = getAdjustedLatitude(slope, WEST_LNG_32V_BOUNDARY, pointTwo);
          adjustedLongitude = WEST_LNG_32V_BOUNDARY;
        } else {
          adjustedLatitude = gzdNorthLatitude;
        }

        return { lat: adjustedLatitude, lng: adjustedLongitude };

      case 'South':
        const gzdSouthLatitude = getGzd(grid.match(TEN_K_MGRS_REGEX)[GZD_INDEX])[SW_INDEX][LATITUDE_INDEX];

        adjustedLongitude = getAdjustedLongitude(slope, gzdSouthLatitude, pointTwo);

        adjustedLatitude = gzdSouthLatitude;
        return { lat: adjustedLatitude, lng: adjustedLongitude };

      default:
        // TODO - lat/lng are undefined if we use this return statement
        return { lat: adjustedLatitude, lng: adjustedLongitude };
    }
  }

  // TODO - REFACTOR HACK
  function getAllVisibleGzds(nwGzd, neGzd, seGzd, swGzd) {
    const GZD_REGEX = /([0-9]+)([A-Z])/;
    const LONGITUDE_BAND_INDEX = 1;
    const LATITUDE_BAND_INDEX = 2;

    // Short circuit
    if (nwGzd === seGzd) {
      return [nwGzd];
    }
    const nwLongitudeBand = parseInt(nwGzd.match(GZD_REGEX)[LONGITUDE_BAND_INDEX]);
    const nwLatitudeBand = nwGzd.match(GZD_REGEX)[LATITUDE_BAND_INDEX];

    const neLongitudeBand = parseInt(neGzd.match(GZD_REGEX)[LONGITUDE_BAND_INDEX]);

    const swLatitudeBand = swGzd.match(GZD_REGEX)[LATITUDE_BAND_INDEX];

    let result = [];

    const longitudeBands = []; // container for the formatted GZDs

    // If the NW GZD is 32V then also include the relevant 31 series GZDs below it
    // This ensures that grids are displayed (since 32V is larger at the expense of 31V)
    if (nwGzd === '32V') {
      longitudeBands.push('31');
    }

    // We span at least two vertical bands
    if (nwLongitudeBand !== neLongitudeBand) {
      for (let i = nwLongitudeBand; i <= neLongitudeBand; i++) {
        longitudeBands.push(i.toString());
      }
      if (nwLatitudeBand !== swLatitudeBand) {
        const initialLongitudeBand = [...longitudeBands];

        let currentLatitudeBand = swLatitudeBand;
        while (currentLatitudeBand <= nwLatitudeBand) {
          const len = initialLongitudeBand.length;

          for (let i = 0; i < len; i++) {
            result.push(initialLongitudeBand[i] + currentLatitudeBand);
          }

          currentLatitudeBand = getNextMgrsGzdCharacter(currentLatitudeBand);
        }

        result = result.flat();
      } else {
        // Append the alpha character to the array of GZDs
        const len = longitudeBands.length;
        for (let i = 0; i < len; i++) {
          longitudeBands[i] = longitudeBands[i].toString() + nwLatitudeBand;
        }
        result = longitudeBands;
      }
    } else {
      // We span a single vertical band
      let currentLatitudeBand = swLatitudeBand;
      const longitudeBand = []; // Container for the formatted GZDs

      while (currentLatitudeBand <= nwLatitudeBand) {
        longitudeBand.push(nwLongitudeBand.toString() + currentLatitudeBand);

        currentLatitudeBand = getNextMgrsGzdCharacter(currentLatitudeBand);
      }
      result = longitudeBand;
    }
    // Remove non-existant X series GZDs around Svalbard
    result = result.filter(function (a) {
      return a !== '32X' && a !== '34X' && a !== '36X';
    });

    // Add 32V if 31W is visible
    // This ensures that grids are displayed (since 32V is larger at the expense of 31V)
    if (result.includes('31W') && !result.includes('32V')) {
      result.push('32V');
    }

    // Handles a special case where 32V can be the NW and NE GZD, but the algorithm
    // doesn't show the 31U GZD
    if (neGzd === '32V' && seGzd === '32U' && !result.includes('31U')) {
      result.push('31U');
    }

    if (nwGzd === '32V' && neGzd === '32V' && !result.includes('31U')) {
      result.push('31U');
    }

    return result;
  }

  function drawLabel(ctx, labelText, textColor, backgroundColor, labelPosition) {
    const textDimensions = ctx.measureText(labelText);
    const textWidth = textDimensions.width;
    // fontBoundingBoxAscent has to be explicitly enabled in Firefox, so check for that
    const textHeight = textDimensions.fontBoundingBoxAscent
      ? textDimensions.fontBoundingBoxAscent
      : parseInt(ctx.font, 10) - 2;

    // Calculate label xy position
    const labelX = labelPosition.x;
    const labelY = labelPosition.y;
    ctx.fillStyle = backgroundColor;
    // Magic numbers will centre the rectangle over the text
    ctx.fillRect(labelX - textWidth / 2 - 1, labelY - textHeight + 1, textWidth + 3, textHeight + 2);
    ctx.fillStyle = textColor;
    ctx.fillText(labelText, labelX - textWidth / 2, labelY);
  }

  //Credit: https://github.com/gustavlarson/gzd-utils/blob/main/src/gzd-utils.ts
  function getGzd(gzd) {
    const lngBand = parseInt(gzd, 10);
    const latBand = gzd.replace(lngBand.toString(), '');

    // Validate
    if (lngBand < 1 || lngBand > 60) {
      throw new RangeError('longitudeBand must be between 1 and 60');
    }
    if (latBand.length !== 1) {
      throw new RangeError('Invalid latitudeBand provided, should be one letter');
    }
    if (!latBands.includes(latBand)) {
      throw new RangeError(`Invalid latitudeBand provided, valid bands: ${latBands}`);
    }
    // Handle invalid zones 32X, 34X, 36X around Svalbard
    if (latBand === 'X' && (lngBand === 32 || lngBand === 34 || lngBand === 36)) {
      throw new RangeError('Invalid band');
    }
    /*
     * Longitude bands 1..60 6° each, covering -180W to 180E
     */
    let longitudeMin = -180 + (lngBand - 1) * 6;
    let longitudeMax = longitudeMin + 6;

    /*
     * Latitude bands C..X 8° each, covering 80°S to 84°N
     * Except band X covering 12°
     */
    const i = latBands.indexOf(latBand);
    const latitudeMin = -80 + i * 8;
    let latitudeMax;
    if (latBand !== 'X') {
      latitudeMax = latitudeMin + 8;
    } else {
      latitudeMax = latitudeMin + 12;
    }

    /*
     * Special case around Norway:
     * Zone 32V is extended 3° west and 31V is shrunk 3°
     */
    if (lngBand === 31 && latBand === 'V') {
      longitudeMax -= 3;
    } else if (lngBand === 32 && latBand === 'V') {
      longitudeMin -= 3;
    }

    /*
     * Special case around Svalbard:
     * - 31X and 37X extended 3°
     * - 33X and 35X extended 6°
     */
    if (lngBand === 31 && latBand === 'X') {
      longitudeMax += 3;
    } else if (lngBand === 33 && latBand === 'X') {
      longitudeMin -= 3;
      longitudeMax += 3;
    } else if (lngBand === 35 && latBand === 'X') {
      longitudeMin -= 3;
      longitudeMax += 3;
    } else if (lngBand === 37 && latBand === 'X') {
      longitudeMin -= 3;
    }

    return [
      [longitudeMin, latitudeMin],
      [longitudeMin, latitudeMax],
      [longitudeMax, latitudeMax],
      [longitudeMax, latitudeMin],
    ];
  }

  return {
    connectToGzdBoundary: connectToGzdBoundary,
    drawLabel: drawLabel,
    getAdjustedLatitude: getAdjustedLatitude,
    getAdjustedLongitude: getAdjustedLongitude,
    getAllVisibleGzds: getAllVisibleGzds,
    getGzd: getGzd,
    getLineSlope: getLineSlope,
    getNextMgrsGzdCharacter: getNextMgrsGzdCharacter,
  };
});