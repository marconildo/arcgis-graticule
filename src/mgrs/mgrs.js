define(function () {
    const NUM_100K_SETS = 6;
    const SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
    const SET_ORIGIN_ROW_LETTERS = 'AFAFAF';
    const A = 65; // A
    const I = 73; // I
    const O = 79; // O
    const V = 86; // V
    const Z = 90; // Z
    const ECC_SQUARED = 0.00669438;
    const SCALE_FACTOR = 0.9996;
    const SEMI_MAJOR_AXIS = 6378137;
    const EASTING_OFFSET = 500000;
    const NORTHING_OFFFSET = 10000000;
    const UTM_ZONE_WIDTH = 6;
    const HALF_UTM_ZONE_WIDTH = UTM_ZONE_WIDTH / 2;

    function forward(ll, accuracy) {
        accuracy = typeof accuracy === 'number' ? accuracy : 5; // default accuracy 1m

        if (!Array.isArray(ll)) {
            throw new TypeError('forward did not receive an array');
        }

        if (typeof ll[0] === 'string' || typeof ll[1] === 'string') {
            throw new TypeError('forward received an array of strings, but it only accepts an array of numbers.');
        }

        const [lon, lat] = ll;
        if (lon < -180 || lon > 180) {
            throw new TypeError(`forward received an invalid longitude of ${lon}`);
        }
        if (lat < -90 || lat > 90) {
            throw new TypeError(`forward received an invalid latitude of ${lat}`);
        }

        if (lat < -80 || lat > 84) {
            throw new TypeError(`forward received a latitude of ${lat}, but this library does not support conversions of points in polar regions below 80°S and above 84°N`);
        }

        return encode(LLtoUTM({ lat, lon }), accuracy);
    }

    function inverse(mgrs) {
        const bbox = UTMtoLL(decode(mgrs.toUpperCase()));
        if (bbox.lat && bbox.lon) {
            return [bbox.lon, bbox.lat, bbox.lon, bbox.lat];
        }
        return [bbox.left, bbox.bottom, bbox.right, bbox.top];
    }

    function toPoint(mgrs) {
        if (mgrs === '') {
            throw new TypeError('toPoint received a blank string');
        }
        const bbox = UTMtoLL(decode(mgrs.toUpperCase()));
        if (bbox.lat && bbox.lon) {
            return [bbox.lon, bbox.lat];
        }
        return [(bbox.left + bbox.right) / 2, (bbox.top + bbox.bottom) / 2];
    }

    function degToRad(deg) {
        return (deg * (Math.PI / 180));
    }

    function radToDeg(rad) {
        return (180 * (rad / Math.PI));
    }

    function LLtoUTM(ll) {
        const Lat = ll.lat;
        const Long = ll.lon;
        const a = SEMI_MAJOR_AXIS;
        const LatRad = degToRad(Lat);
        const LongRad = degToRad(Long);
        let ZoneNumber;
        ZoneNumber = Math.floor((Long + 180) / 6) + 1;

        //Make sure the longitude 180 is in Zone 60
        if (Long === 180) {
            ZoneNumber = 60;
        }

        // Special zone for Norway
        if (Lat >= 56 && Lat < 64 && Long >= 3 && Long < 12) {
            ZoneNumber = 32;
        }

        // Special zones for Svalbard
        if (Lat >= 72 && Lat < 84) {
            if (Long >= 0 && Long < 9) {
                ZoneNumber = 31;
            }
            else if (Long >= 9 && Long < 21) {
                ZoneNumber = 33;
            }
            else if (Long >= 21 && Long < 33) {
                ZoneNumber = 35;
            }
            else if (Long >= 33 && Long < 42) {
                ZoneNumber = 37;
            }
        }

        // +HALF_UTM_ZONE_WIDTH puts origin in middle of zone
        const LongOrigin = (ZoneNumber - 1) * UTM_ZONE_WIDTH - 180 + HALF_UTM_ZONE_WIDTH;

        const LongOriginRad = degToRad(LongOrigin);

        const eccPrimeSquared = (ECC_SQUARED) / (1 - ECC_SQUARED);

        const N = a / Math.sqrt(1 - ECC_SQUARED * Math.sin(LatRad) * Math.sin(LatRad));
        const T = Math.tan(LatRad) * Math.tan(LatRad);
        const C = eccPrimeSquared * Math.cos(LatRad) * Math.cos(LatRad);
        const A = Math.cos(LatRad) * (LongRad - LongOriginRad);

        const M = a * ((1 - ECC_SQUARED / 4 - 3 * ECC_SQUARED * ECC_SQUARED / 64 - 5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 256) * LatRad - (3 * ECC_SQUARED / 8 + 3 * ECC_SQUARED * ECC_SQUARED / 32 + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024) * Math.sin(2 * LatRad) + (15 * ECC_SQUARED * ECC_SQUARED / 256 + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024) * Math.sin(4 * LatRad) - (35 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 3072) * Math.sin(6 * LatRad));

        const UTMEasting = (SCALE_FACTOR * N * (A + (1 - T + C) * A * A * A / 6 + (5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * A * A * A * A * A / 120) + EASTING_OFFSET);

        let UTMNorthing = (SCALE_FACTOR * (M + N * Math.tan(LatRad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 + (61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared) * A * A * A * A * A * A / 720)));
        if (Lat < 0) {
            UTMNorthing += NORTHING_OFFFSET;
        }

        return {
            northing: Math.trunc(UTMNorthing),
            easting: Math.trunc(UTMEasting),
            zoneNumber: ZoneNumber,
            zoneLetter: getLetterDesignator(Lat)
        };
    }

    function UTMtoLL(utm) {

        const UTMNorthing = utm.northing;
        const UTMEasting = utm.easting;
        const { zoneLetter, zoneNumber } = utm;
        // check the ZoneNummber is valid
        if (zoneNumber < 0 || zoneNumber > 60) {
            return null;
        }

        const a = SEMI_MAJOR_AXIS;
        const e1 = (1 - Math.sqrt(1 - ECC_SQUARED)) / (1 + Math.sqrt(1 - ECC_SQUARED));

        // remove 500,000 meter offset for longitude
        const x = UTMEasting - EASTING_OFFSET;
        let y = UTMNorthing;

        // We must know somehow if we are in the Northern or Southern
        // hemisphere, this is the only time we use the letter So even
        // if the Zone letter isn't exactly correct it should indicate
        // the hemisphere correctly
        if (zoneLetter < 'N') {
            y -= NORTHING_OFFFSET; // remove offset used for southern hemisphere
        }

        // +HALF_UTM_ZONE_WIDTH puts origin in middle of zone
        const LongOrigin = (zoneNumber - 1) * UTM_ZONE_WIDTH - 180 + HALF_UTM_ZONE_WIDTH;

        const eccPrimeSquared = (ECC_SQUARED) / (1 - ECC_SQUARED);

        const M = y / SCALE_FACTOR;
        const mu = M / (a * (1 - ECC_SQUARED / 4 - 3 * ECC_SQUARED * ECC_SQUARED / 64 - 5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 256));

        const phi1Rad = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);
        // double phi1 = ProjMath.radToDeg(phi1Rad);

        const N1 = a / Math.sqrt(1 - ECC_SQUARED * Math.sin(phi1Rad) * Math.sin(phi1Rad));
        const T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
        const C1 = eccPrimeSquared * Math.cos(phi1Rad) * Math.cos(phi1Rad);
        const R1 = a * (1 - ECC_SQUARED) / Math.pow(1 - ECC_SQUARED * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
        const D = x / (N1 * SCALE_FACTOR);

        let lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccPrimeSquared) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccPrimeSquared - 3 * C1 * C1) * D * D * D * D * D * D / 720);
        lat = radToDeg(lat);

        let lon = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccPrimeSquared + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1Rad);
        lon = LongOrigin + radToDeg(lon);

        let result;
        if (typeof utm.accuracy === 'number') {
            const topRight = UTMtoLL({
                northing: utm.northing + utm.accuracy,
                easting: utm.easting + utm.accuracy,
                zoneLetter: utm.zoneLetter,
                zoneNumber: utm.zoneNumber
            });
            result = {
                top: topRight.lat,
                right: topRight.lon,
                bottom: lat,
                left: lon
            };
        }
        else {
            result = {
                lat,
                lon
            };
        }
        return result;
    }

    function getLetterDesignator(latitude) {
        if (latitude <= 84 && latitude >= 72) {
            // the X band is 12 degrees high
            return 'X';
        } else if (latitude < 72 && latitude >= -80) {
            // Latitude bands are lettered C through X, excluding I and O
            const bandLetters = 'CDEFGHJKLMNPQRSTUVWX';
            const bandHeight = 8;
            const minLatitude = -80;
            const index = Math.floor((latitude - minLatitude) / bandHeight);
            return bandLetters[index];
        } else if (latitude > 84 || latitude < -80) {
            //This is here as an error flag to show that the Latitude is
            //outside MGRS limits
            return 'Z';
        }
    }

    function encode(utm, accuracy) {
        // prepend with leading zeroes
        const seasting = '00000' + utm.easting,
            snorthing = '00000' + utm.northing;

        return utm.zoneNumber + utm.zoneLetter + get100kID(utm.easting, utm.northing, utm.zoneNumber) + seasting.substr(seasting.length - 5, accuracy) + snorthing.substr(snorthing.length - 5, accuracy);
    }

    function get100kID(easting, northing, zoneNumber) {
        const setParm = get100kSetForZone(zoneNumber);
        const setColumn = Math.floor(easting / 100000);
        const setRow = Math.floor(northing / 100000) % 20;
        return getLetter100kID(setColumn, setRow, setParm);
    }

    function get100kSetForZone(i) {
        let setParm = i % NUM_100K_SETS;
        if (setParm === 0) {
            setParm = NUM_100K_SETS;
        }

        return setParm;
    }

    function getLetter100kID(column, row, parm) {
        // colOrigin and rowOrigin are the letters at the origin of the set
        const index = parm - 1;
        const colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
        const rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

        // colInt and rowInt are the letters to build to return
        let colInt = colOrigin + column - 1;
        let rowInt = rowOrigin + row;
        let rollover = false;

        if (colInt > Z) {
            colInt = colInt - Z + A - 1;
            rollover = true;
        }

        if (colInt === I || (colOrigin < I && colInt > I) || ((colInt > I || colOrigin < I) && rollover)) {
            colInt++;
        }

        if (colInt === O || (colOrigin < O && colInt > O) || ((colInt > O || colOrigin < O) && rollover)) {
            colInt++;

            if (colInt === I) {
                colInt++;
            }
        }

        if (colInt > Z) {
            colInt = colInt - Z + A - 1;
        }

        if (rowInt > V) {
            rowInt = rowInt - V + A - 1;
            rollover = true;
        }
        else {
            rollover = false;
        }

        if (((rowInt === I) || ((rowOrigin < I) && (rowInt > I))) || (((rowInt > I) || (rowOrigin < I)) && rollover)) {
            rowInt++;
        }

        if (((rowInt === O) || ((rowOrigin < O) && (rowInt > O))) || (((rowInt > O) || (rowOrigin < O)) && rollover)) {
            rowInt++;

            if (rowInt === I) {
                rowInt++;
            }
        }

        if (rowInt > V) {
            rowInt = rowInt - V + A - 1;
        }

        const twoLetter = String.fromCharCode(colInt) + String.fromCharCode(rowInt);
        return twoLetter;
    }

    function decode(mgrsString) {

        if (mgrsString && mgrsString.length === 0) {
            throw new TypeError('MGRSPoint coverting from nothing');
        }

        //remove any spaces in MGRS String
        mgrsString = mgrsString.replace(/ /g, '');

        const { length } = mgrsString;

        let hunK = null;
        let sb = '';
        let testChar;
        let i = 0;

        // get Zone number
        while (!(/[A-Z]/).test(testChar = mgrsString.charAt(i))) {
            if (i >= 2) {
                throw new Error(`MGRSPoint bad conversion from: ${mgrsString}`);
            }
            sb += testChar;
            i++;
        }

        const zoneNumber = parseInt(sb, 10);

        if (i === 0 || i + 3 > length) {
            // A good MGRS string has to be 4-5 digits long,
            // ##AAA/#AAA at least.
            throw new Error(`MGRSPoint bad conversion from ${mgrsString}`);
        }

        const zoneLetter = mgrsString.charAt(i++);

        // Should we check the zone letter here? Why not.
        if (zoneLetter <= 'A' || zoneLetter === 'B' || zoneLetter === 'Y' || zoneLetter >= 'Z' || zoneLetter === 'I' || zoneLetter === 'O') {
            throw new Error(`MGRSPoint zone letter ${zoneLetter} not handled: ${mgrsString}`);
        }

        hunK = mgrsString.substring(i, i += 2);

        const set = get100kSetForZone(zoneNumber);

        const east100k = getEastingFromChar(hunK.charAt(0), set);
        let north100k = getNorthingFromChar(hunK.charAt(1), set);

        // We have a bug where the northing may be 2000000 too low.
        // How
        // do we know when to roll over?

        while (north100k < getMinNorthing(zoneLetter)) {
            north100k += 2000000;
        }

        // calculate the char index for easting/northing separator
        const remainder = length - i;

        if (remainder % 2 !== 0) {
            throw new Error(`MGRSPoint has to have an even number
                of digits after the zone letter and two 100km letters - front
                half for easting meters, second half for
                northing meters ${mgrsString}`);
        }

        const sep = remainder / 2;

        let sepEasting = 0;
        let sepNorthing = 0;
        let accuracyBonus, sepEastingString, sepNorthingString;
        if (sep > 0) {
            accuracyBonus = 100000 / Math.pow(10, sep);
            sepEastingString = mgrsString.substring(i, i + sep);
            sepEasting = parseFloat(sepEastingString) * accuracyBonus;
            sepNorthingString = mgrsString.substring(i + sep);
            sepNorthing = parseFloat(sepNorthingString) * accuracyBonus;
        }

        const easting = sepEasting + east100k;
        const northing = sepNorthing + north100k;

        return {
            easting,
            northing,
            zoneLetter,
            zoneNumber,
            accuracy: accuracyBonus
        };
    }

    function getEastingFromChar(e, set) {
        // colOrigin is the letter at the origin of the set for the
        // column
        let curCol = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(set - 1);
        let eastingValue = 100000;
        let rewindMarker = false;

        while (curCol !== e.charCodeAt(0)) {
            curCol++;
            if (curCol === I) {
                curCol++;
            }
            if (curCol === O) {
                curCol++;
            }
            if (curCol > Z) {
                if (rewindMarker) {
                    throw new Error(`Bad character: ${e}`);
                }
                curCol = A;
                rewindMarker = true;
            }
            eastingValue += 100000;
        }

        return eastingValue;
    }

    function getNorthingFromChar(n, set) {

        if (n > 'V') {
            throw new TypeError(`MGRSPoint given invalid Northing ${n}`);
        }

        // rowOrigin is the letter at the origin of the set for the
        // column
        let curRow = SET_ORIGIN_ROW_LETTERS.charCodeAt(set - 1);
        let northingValue = 0;
        let rewindMarker = false;

        while (curRow !== n.charCodeAt(0)) {
            curRow++;
            if (curRow === I) {
                curRow++;
            }
            if (curRow === O) {
                curRow++;
            }
            // fixing a bug making whole application hang in this loop
            // when 'n' is a wrong character
            if (curRow > V) {
                if (rewindMarker) { // making sure that this loop ends
                    throw new Error(`Bad character: ${n}`);
                }
                curRow = A;
                rewindMarker = true;
            }
            northingValue += 100000;
        }

        return northingValue;
    }

    function getMinNorthing(zoneLetter) {
        let northing;
        switch (zoneLetter) {
            case 'C':
                northing = 1100000;
                break;
            case 'D':
                northing = 2000000;
                break;
            case 'E':
                northing = 2800000;
                break;
            case 'F':
                northing = 3700000;
                break;
            case 'G':
                northing = 4600000;
                break;
            case 'H':
                northing = 5500000;
                break;
            case 'J':
                northing = 6400000;
                break;
            case 'K':
                northing = 7300000;
                break;
            case 'L':
                northing = 8200000;
                break;
            case 'M':
                northing = 9100000;
                break;
            case 'N':
                northing = 0;
                break;
            case 'P':
                northing = 800000;
                break;
            case 'Q':
                northing = 1700000;
                break;
            case 'R':
                northing = 2600000;
                break;
            case 'S':
                northing = 3500000;
                break;
            case 'T':
                northing = 4400000;
                break;
            case 'U':
                northing = 5300000;
                break;
            case 'V':
                northing = 6200000;
                break;
            case 'W':
                northing = 7000000;
                break;
            case 'X':
                northing = 7900000;
                break;
            default:
                northing = -1;
        }
        if (northing >= 0) {
            return northing;
        }
        else {
            throw new TypeError(`Invalid zone letter: ${zoneLetter}`);
        }

    }

    return {
        forward: forward,
        getLetterDesignator: getLetterDesignator,
        inverse: inverse,
        toPoint: toPoint
    }
});