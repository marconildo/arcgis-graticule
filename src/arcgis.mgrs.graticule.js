
define([
    "esri/layers/Layer",
    "esri/geometry/Point",
    "esri/geometry/Extent",
    "esri/geometry/support/webMercatorUtils",
    "esri/geometry/geometryEngine",
    "esri/views/2d/layers/BaseLayerView2D",
    "esri/geometry/SpatialReference",
    "esri/geometry/projection",
    "../src/mgrs/commonUtils.js",
    "../src/mgrs/coordinates.js",
], function (
    Layer,
    Point,
    Extent,
    webMercatorUtils,
    geometryEngine,
    BaseLayerView2D,
    SpatialReference,
    projection,
    commonUtils,
    coordinates
) {
    this.currLatInterval = 8;
    this.currLngInterval = 6;

    const SW_INDEX = 0;
    const NW_INDEX = 1;
    const NE_INDEX = 2;

    const LATITUDE_INDEX = 1;
    const LONGITUDE_INDEX = 0;

    const MGRS_REGEX = /([0-9]+[A-Z])([A-Z]{2})(\d+)/;
    const GZD_INDEX = 1;
    const HK_INDEX = 2;
    const GRID_INDEX = 3;

    const MgrsGraticuleLayerView = BaseLayerView2D.createSubclass({
        constructor: (params) => {
            this.view = params.view;
            this.layer = params.layer;
        },
        attach: () => {
            projection.load();
        },
        render: (renderParameters) => {
            const state = renderParameters.state;
            const ctx = renderParameters.context;
            const options = this.layer.options;
            const canvas = ctx.canvas;

            const mapLeftTop = this.view.toMap([0, 0]);
            canvas.style['transform'] = `translate3d(${mapLeftTop.x}px,${mapLeftTop.y}px,0)`;
            
            projection.load();

            const extent = this.view.extent;
            const zoom = Math.round(this.view.zoom);

            const srWGS84 = new SpatialReference({ wkid: 4326 });
            const extentWGS84 = projection.project(extent, srWGS84);

            if (!extentWGS84) {
                return;
            }

            let mgrsGridInterval = null;
            if (zoom > options.hundredMMinZoom) {
                mgrsGridInterval = 100; //100m
            } else if (zoom > options.oneKMinZoom) {
                mgrsGridInterval = 1000; //1km
            } else if (zoom > options.tenKMinZoom) {
                mgrsGridInterval = 10000; //10km
            } else if (zoom > options.hundredKMinZoom) {
                mgrsGridInterval = 100000; //100km
            }

            drawGrid(ctx, state, srWGS84, extentWGS84, mgrsGridInterval, options, zoom);
            drawGzd(ctx, this.view, state, srWGS84, options, zoom);
        },
        detach() {
        }
    });

    const MgrsGraticuleLayer = Layer.createSubclass({
        properties: {
            // Opções de estilo
            name: { value: "mgrsGraticule" },
            checked: { value: true },
            options: {
                value: {
                    showGrid: true,
                    color: '#888888',
                    font: '14px Courier New',
                    fontColor: '#ffffff',
                    dashArray: [4, 4],
                    weight: 1.5,
                    gridColor: '#000000',
                    hkColor: '#990000',
                    hkDashArray: [4, 4],
                    gridFont: '14px Courier New',
                    gridFontColor: '#ffffff',
                    gridDashArray: [],
                    hundredKMinZoom: 6,
                    tenKMinZoom: 9,
                    oneKMinZoom: 12,
                    hundredMMinZoom: 15,
                }
            }
        },
        constructor: (params) => {
        },
        createLayerView: function (view) {
            const layer = this;
            if (view.type === "2d") {
                return new MgrsGraticuleLayerView({
                    view: view,
                    layer: layer
                });
            }
        }
    });

    function drawGrid(ctx, state, srWGS84, extent, mgrsInterval, options, zoom) {
        if (zoom < options.hundredKMinZoom) {
            return;
        }

        ctx.lineWidth = options.weight;
        ctx.strokeStyle = options.color;
        ctx.fillStyle = options.color;
        ctx.lineCap = 'round';
        ctx.setLineDash(options.dashArray);
        ctx.font = options.font;

        const visibleGzds = getVizGzds(extent);
        if (!visibleGzds) {
            return;
        }

        visibleGzds.forEach((gzd) => {
            let gzdObject;
            try {
                gzdObject = commonUtils.getGzd(gzd);
            } catch (e) {
                return;
            }

            const gzdWestBoundary = gzdObject[NW_INDEX][LONGITUDE_INDEX];
            const gzdEastBoundary = gzdObject[NE_INDEX][LONGITUDE_INDEX];
            const gzdNorthBoundary = gzdObject[NW_INDEX][LATITUDE_INDEX];
            const gzdSouthBoundary = gzdObject[SW_INDEX][LATITUDE_INDEX];

            // If drawing HK grids, just draw the entire GZD regardless
            const effectiveWestBoundary =
                gzdWestBoundary < extent.xmin && mgrsInterval !== 100000
                    ? extent.xmin
                    : gzdWestBoundary;
            const effectiveEastBoundary =
                gzdEastBoundary > extent.xmax && mgrsInterval !== 100000
                    ? extent.xmax
                    : gzdEastBoundary;
            const effectiveNorthBoundary = gzdNorthBoundary > extent.ymax ? extent.ymax : gzdNorthBoundary;
            const effectiveSouthBoundary = gzdSouthBoundary < extent.ymin ? extent.ymin : gzdSouthBoundary;

            const buffer = 0.00001;
            const swCornerUtm = coordinates.llToUtm(effectiveSouthBoundary + buffer, effectiveWestBoundary + buffer);
            const seCornerUtm = coordinates.llToUtm(effectiveSouthBoundary + buffer, effectiveEastBoundary - buffer);
            const nwCornerUtm = coordinates.llToUtm(effectiveNorthBoundary - buffer, effectiveWestBoundary + buffer);
            const neCornerUtm = coordinates.llToUtm(effectiveNorthBoundary - buffer, effectiveEastBoundary - buffer);

            let startingEasting = extent.center.y >= 0 ? swCornerUtm.easting : nwCornerUtm.easting;
            let finalEasting = extent.center.y >= 0 ? seCornerUtm.easting : neCornerUtm.easting;

            let startingNorthing = swCornerUtm.northing > seCornerUtm.northing ? seCornerUtm.northing : swCornerUtm.northing;
            let finalNorthing = nwCornerUtm.northing > neCornerUtm.northing ? nwCornerUtm.northing : neCornerUtm.northing;

            startingEasting = Math.floor(startingEasting / mgrsInterval) * mgrsInterval;
            finalEasting = Math.ceil(finalEasting / mgrsInterval) * mgrsInterval;
            startingNorthing = Math.floor(startingNorthing / mgrsInterval) * mgrsInterval;
            finalNorthing = Math.ceil(finalNorthing / mgrsInterval) * mgrsInterval;

            let eastingArray = [];
            for (let i = startingEasting; i <= finalEasting; i += mgrsInterval) {
                eastingArray.push(i);
            }

            let northingArray = [];
            for (let i = startingNorthing; i <= finalNorthing; i += mgrsInterval) {
                northingArray.push(i);
            }

            let zoneLetter = nwCornerUtm.zoneLetter;
            let zoneNumber = nwCornerUtm.zoneNumber;

            eastingArray.forEach((eastingElem) => {
                let initialPlacementCompleted = false;
                ctx.beginPath();
                try {
                    northingArray.forEach((northingElem, northingIndex, northArr) => {
                        let gridIntersectionLl = coordinates.utmToLl(eastingElem, northingElem, zoneNumber, zoneLetter);
                        if (gridIntersectionLl.lng > gzdEastBoundary) {
                            return;
                        } else if (gridIntersectionLl.lng < gzdWestBoundary) {
                            return;
                        }

                        if (gridIntersectionLl.lat < gzdSouthBoundary) {
                            let nextIntersectionLl = coordinates.utmToLl(eastingElem, northArr[northingIndex + 1], zoneNumber, zoneLetter);
                            gridIntersectionLl = commonUtils.connectToGzdBoundary(gridIntersectionLl, nextIntersectionLl, 'North');
                            // This block will truncate the line at the northern boundary of the GZD

                        } else if (gridIntersectionLl.lat > gzdNorthBoundary) {
                            let previousIntersectionLl = coordinates.utmToLl(eastingElem, northArr[northingIndex - 1], zoneNumber, zoneLetter);
                            gridIntersectionLl = commonUtils.connectToGzdBoundary(gridIntersectionLl, previousIntersectionLl, 'South');
                        }

                        let gridIntersectionXy;
                        if (Number.isFinite(gridIntersectionLl.lat) && Number.isFinite(gridIntersectionLl.lng)) {
                            gridIntersectionXy = latLngToContainerPoint(gridIntersectionLl, state, srWGS84);
                            if (!initialPlacementCompleted) {
                                ctx.moveTo(gridIntersectionXy.x, gridIntersectionXy.y);
                                initialPlacementCompleted = true;
                            } else {
                                ctx.lineTo(gridIntersectionXy.x, gridIntersectionXy.y);
                            }
                        } else {
                            return;
                        }
                    });
                    const notHkLine = eastingElem % 100000 !== 0;
                    drawLine(ctx, notHkLine, options);
                } catch (e) { }
            });

            northingArray.forEach((northingElem) => {
                let beginPathCalled = false;
                eastingArray.forEach((eastingElem, eastingIndex, eastArr) => {
                    let gridIntersectionLl = coordinates.utmToLl(eastingElem, northingElem, zoneNumber, zoneLetter);

                    if (gridIntersectionLl.lat > gzdNorthBoundary || gridIntersectionLl.lat < gzdSouthBoundary) {
                        if (!beginPathCalled) {
                            ctx.beginPath();
                            beginPathCalled = true;
                        }
                        return;
                    }

                    let gridIntersectionXy = latLngToContainerPoint(gridIntersectionLl, state);
                    if (!beginPathCalled) {
                        if (gridIntersectionLl.lng < effectiveWestBoundary) {
                            const nextGridIntersectionLl = coordinates.utmToLl(eastArr[eastingIndex + 1], northingElem, zoneNumber, zoneLetter);

                            if (nextGridIntersectionLl.lng < effectiveWestBoundary) {
                                return;
                            }
                            const slope = commonUtils.getLineSlope(gridIntersectionLl, nextGridIntersectionLl);

                            try {
                                gridIntersectionLl.lat = commonUtils.getAdjustedLatitude(slope, effectiveWestBoundary, gridIntersectionLl);

                                gridIntersectionLl.lng = effectiveWestBoundary;

                                gridIntersectionXy = latLngToContainerPoint(gridIntersectionLl, state, srWGS84);
                            } catch (e) {
                                console.error(e);
                                console.trace();
                            }
                        }
                        ctx.beginPath();
                        beginPathCalled = true;
                        ctx.moveTo(gridIntersectionXy.x, gridIntersectionXy.y);
                    } else {
                        if (gridIntersectionLl.lng > effectiveEastBoundary) {
                            const previousGridIntersectionLl = coordinates.utmToLl(
                                eastArr[eastingIndex - 1],
                                northingElem,
                                zoneNumber,
                                zoneLetter
                            );
                            const slope = commonUtils.getLineSlope(gridIntersectionLl, previousGridIntersectionLl);

                            try {
                                gridIntersectionLl.lat = commonUtils.getAdjustedLatitude(slope, effectiveEastBoundary, gridIntersectionLl);

                                gridIntersectionLl.lng = effectiveEastBoundary;

                                gridIntersectionXy = latLngToContainerPoint(gridIntersectionLl, state, srWGS84);
                            } catch (e) {
                                console.error(e);
                                console.trace();
                            }
                        }
                        ctx.lineTo(gridIntersectionXy.x, gridIntersectionXy.y);
                    }
                });
                const notHkLine = northingElem % 100000 !== 0;
                drawLine(ctx, notHkLine, options);
            });

            if (mgrsInterval === 100000) {
                eastingArray.forEach((eastingElem, eastingIndex, ea) => {
                    northingArray.forEach((northingElem, northingIndex, na) => {
                        let labelLl;
                        let currentLl = coordinates.utmToLl(eastingElem, northingElem, zoneNumber, zoneLetter);
                        let adjacentLlNorthing;
                        let adjacentLlEasting;
                        if (ea[eastingIndex + 1]) {
                            adjacentLlEasting = coordinates.utmToLl(ea[eastingIndex + 1], northingElem, zoneNumber, zoneLetter);

                            if (adjacentLlEasting.lng > effectiveEastBoundary) {
                                const slope = commonUtils.getLineSlope(currentLl, adjacentLlEasting);
                                adjacentLlEasting.lat = commonUtils.getAdjustedLatitude(slope, effectiveEastBoundary, adjacentLlEasting);
                                adjacentLlEasting.lng = effectiveEastBoundary;
                            }
                        } else { return; }

                        if (na[northingIndex + 1]) {
                            if (eastingIndex === 0) {
                                adjacentLlNorthing = coordinates.utmToLl(ea[eastingIndex + 1], na[northingIndex + 1], zoneNumber, zoneLetter);
                            } else {
                                adjacentLlNorthing = coordinates.utmToLl(eastingElem, na[northingIndex + 1], zoneNumber, zoneLetter);
                            }
                        } else { return; }

                        if (currentLl.lng < effectiveWestBoundary) {
                            const slope = commonUtils.getLineSlope(currentLl, adjacentLlEasting);
                            currentLl.lat = commonUtils.getAdjustedLatitude(slope, effectiveWestBoundary, currentLl);
                            currentLl.lng = effectiveWestBoundary;
                        } else if (currentLl.lng > effectiveEastBoundary) {
                            return;
                        }

                        labelLl = {
                            lat: (currentLl.lat + adjacentLlNorthing.lat) / 2,
                            lng: (currentLl.lng + adjacentLlEasting.lng) / 2,
                        };

                        try {
                            const effectiveBounds = new Extent({
                                xmin: effectiveWestBoundary,
                                ymin: effectiveSouthBoundary,
                                xmax: effectiveEastBoundary,
                                ymax: effectiveNorthBoundary,
                                spatialReference: srWGS84
                            });

                            const labelPoint = new Point({
                                longitude: labelLl.lng,
                                latitude: labelLl.lat,
                                spatialReference: srWGS84
                            });

                            if (labelLl && labelPoint && effectiveBounds.contains(labelPoint)) {
                                let labelText = coordinates.llToMgrs([labelLl.lng, labelLl.lat]).match(MGRS_REGEX)[HK_INDEX];
                                const labelPoint = latLngToScreenPoint(labelLl, state, srWGS84);
                                const adjacentLlEastingPoint = latLngToScreenPoint(adjacentLlEasting, state, srWGS84);
                                const distance = geometryEngine.distance(labelPoint, adjacentLlEastingPoint);
                                if (distance < ctx.measureText(labelText).width * 2) {
                                    return;
                                }

                                commonUtils.drawLabel(
                                    ctx,
                                    labelText,
                                    options.gridFontColor,
                                    options.hkColor,
                                    latLngToContainerPoint(labelLl, state, srWGS84)
                                );
                            }
                        } catch (e) {
                            return;
                        }
                    });
                });
            } else {
                eastingArray.forEach((eastingElem, eastingIndex, ea) => {
                    if (!(eastingIndex === 0 || eastingIndex === ea.length - 1)) {
                        let labelXy;
                        try {
                            let labelLl = coordinates.utmToLl(eastingElem, northingArray[1], zoneNumber, zoneLetter);
                            labelXy = latLngToContainerPoint({ lat: effectiveSouthBoundary, lng: labelLl.lng }, state, srWGS84);
                        } catch (e) {
                            return;
                        }

                        let labelText = getLabelText(eastingElem, mgrsInterval);

                        commonUtils.drawLabel(ctx, labelText, options.gridFontColor, options.gridColor, {
                            x: labelXy.x,
                            y: labelXy.y - 15,
                        });
                    }
                });

                northingArray.forEach((northingElem) => {
                    let labelXy;
                    try {
                        let labelLl = coordinates.utmToLl(eastingArray[eastingArray.length - 1], northingElem, zoneNumber, zoneLetter);
                        labelXy = latLngToContainerPoint({ lat: labelLl.lat, lng: effectiveEastBoundary }, state, srWGS84);
                    } catch (e) {
                        return;
                    }

                    let labelText = getLabelText(northingElem, mgrsInterval);
                    commonUtils.drawLabel(ctx, labelText, options.gridFontColor, options.gridColor, {
                        x: labelXy.x - 15,
                        y: labelXy.y,
                    });
                });
            }
        });
    }

    function drawGzd(ctx, view, state, srWGS84, options, zoom) {
        if (!ctx) {
            return;
        }

        if (zoom < options.minZoom) {
            return;
        }

        ctx.lineWidth = options.weight;
        ctx.strokeStyle = options.color;
        ctx.fillStyle = options.color;
        ctx.setLineDash(options.dashArray);
        if (options.font) {
            ctx.font = options.font;
        }

        let leftTop = view.toMap({ x: 0, y: 0 });
        let rightBottom = view.toMap({ x: view.width, y: view.height });

        let pointPerLat = (leftTop.latitude - rightBottom.latitude) / (view.height * 0.2);
        let pointPerLon = (rightBottom.longitude - leftTop.longitude) / (view.width * 0.2);

        if (isNaN(pointPerLat) || isNaN(pointPerLon)) {
            return;
        }

        if (pointPerLat < 1) {
            pointPerLat = 1;
        }
        if (pointPerLon < 1) {
            pointPerLon = 1;
        }

        if (rightBottom.latitude < -90) {
            rightBottom.latitude = -90;
        } else {
            rightBottom.latitude = parseInt(rightBottom.latitude - pointPerLat, 10);
        }

        if (leftTop.latitude > 90) {
            leftTop.latitude = 90;
        } else {
            leftTop.latitude = parseInt(leftTop.latitude + pointPerLat, 10);
        }

        if (leftTop.longitude > 0 && rightBottom.longitude < 0) {
            rightBottom.longitude += 360;
        }
        rightBottom.longitude = parseInt(rightBottom.longitude + pointPerLon, 10);
        leftTop.longitude = parseInt(leftTop.longitude - pointPerLon, 10);

        // Northern hemisphere
        for (let i = this.currLatInterval; i <= leftTop.latitude; i += this.currLatInterval) {
            if (i >= rightBottom.latitude) {
                if (i === 80) {
                    i = 84;
                }
                drawLatitudeLine(ctx, i, leftTop.longitude, rightBottom.longitude, state, srWGS84);
            }
        }

        // Southern hemisphere
        for (let i = 0; i >= rightBottom.latitude; i -= this.currLatInterval) {
            if (i <= leftTop.latitude) {
                drawLatitudeLine(ctx, i, leftTop.longitude, rightBottom.longitude, state, srWGS84);
            }
        }

        // HACK - Add six to the right bottom lng to make sure the East 31V boundary is displayed at all times
        for (let i = -180; i <= rightBottom.longitude + 6; i += this.currLngInterval) {
            drawLongitudeLine(ctx, options, i, leftTop.latitude, rightBottom.latitude, state, srWGS84);
        }
    }

    function drawLatitudeLine(ctx, tick, lngLeft, lngRight, state, srWGS84) {
        const leftEnd = latLngToContainerPoint({
            lat: tick,
            lng: lngLeft,
        }, state, srWGS84);

        const rightEnd = latLngToContainerPoint({
            lat: tick,
            lng: lngRight,
        }, state, srWGS84);

        ctx.beginPath();
        ctx.moveTo(leftEnd.x, leftEnd.y);
        ctx.lineTo(rightEnd.x, rightEnd.y);
        ctx.stroke();
    }

    function drawLongitudeLine(ctx, options, tick, latTop, latBottom, state, srWGS84) {
        if (latTop >= 84) {
            latTop = 84; // Ensure GZD vertical lines do not extend into the arctic
        }

        if (latBottom <= -80) {
            latBottom = -80; // Ensure GZD vertical lines do not extend into the antarctic
        }

        const canvasTop = latLngToContainerPoint({
            lat: latTop,
            lng: tick,
        }, state, srWGS84);

        const canvasBottom = latLngToContainerPoint({
            lat: latBottom,
            lng: tick,
        }, state, srWGS84);

        const TOP_OF_W_SERIES_GZD = 72;

        ctx.beginPath();
        // Handle Norway
        if (tick === 6) {
            const TOP_OF_V_SERIES_GZD = 64;
            const BOTTOM_OF_V_SERIES_GZD = 56;
            const RIGHT_OF_31_SERIES_GZD = 3;

            const RIGHT_TOP_OF_GZD = latLngToContainerPoint({
                lat: TOP_OF_V_SERIES_GZD,
                lng: tick,
            }, state, srWGS84);

            const LEFT_TOP_OF_GZD = latLngToContainerPoint({
                lat: TOP_OF_V_SERIES_GZD,
                lng: RIGHT_OF_31_SERIES_GZD,
            }, state, srWGS84);

            const LEFT_BOTTOM_OF_GZD = latLngToContainerPoint({
                lat: BOTTOM_OF_V_SERIES_GZD,
                lng: RIGHT_OF_31_SERIES_GZD,
            }, state, srWGS84);

            const RIGHT_BOTTOM_OF_GZD = latLngToContainerPoint({
                lat: BOTTOM_OF_V_SERIES_GZD,
                lng: tick,
            }, state, srWGS84);

            if (latTop > TOP_OF_V_SERIES_GZD && latBottom > BOTTOM_OF_V_SERIES_GZD) {
                // Top segment only
                // Do not draw through Svalbard
                if (latTop > TOP_OF_W_SERIES_GZD) {
                    const TOP_LEFT_OF_32_SERIES_GZD = latLngToContainerPoint({
                        lat: TOP_OF_W_SERIES_GZD,
                        lng: tick,
                    }, state, srWGS84);
                    ctx.moveTo(TOP_LEFT_OF_32_SERIES_GZD.x, TOP_LEFT_OF_32_SERIES_GZD.y);
                } else {
                    ctx.moveTo(canvasTop.x, canvasTop.y);
                }

                ctx.lineTo(RIGHT_TOP_OF_GZD.x, RIGHT_TOP_OF_GZD.y);

                ctx.moveTo(LEFT_TOP_OF_GZD.x, LEFT_TOP_OF_GZD.y);

                ctx.lineTo(LEFT_TOP_OF_GZD.x, canvasBottom.y);
            } else if (
                //Bottom segment only
                latTop < TOP_OF_V_SERIES_GZD &&
                latBottom < BOTTOM_OF_V_SERIES_GZD
            ) {
                ctx.moveTo(LEFT_TOP_OF_GZD.x, canvasTop.y);

                ctx.lineTo(LEFT_BOTTOM_OF_GZD.x, LEFT_BOTTOM_OF_GZD.y);

                ctx.moveTo(RIGHT_BOTTOM_OF_GZD.x, RIGHT_BOTTOM_OF_GZD.y);

                ctx.lineTo(RIGHT_BOTTOM_OF_GZD.x, canvasBottom.y);
            } else if (
                // Entire thing
                latTop >= TOP_OF_V_SERIES_GZD &&
                latBottom <= BOTTOM_OF_V_SERIES_GZD
            ) {
                // Do not draw through Svalbard
                if (latTop > TOP_OF_W_SERIES_GZD) {
                    const TOP_LEFT_OF_32_SERIES_GZD = latLngToContainerPoint({
                        lat: TOP_OF_W_SERIES_GZD,
                        lng: tick,
                    }, state, srWGS84);
                    ctx.moveTo(TOP_LEFT_OF_32_SERIES_GZD.x, TOP_LEFT_OF_32_SERIES_GZD.y);
                } else {
                    ctx.moveTo(canvasTop.x, canvasTop.y);
                }

                ctx.lineTo(RIGHT_TOP_OF_GZD.x, RIGHT_TOP_OF_GZD.y);

                ctx.moveTo(LEFT_TOP_OF_GZD.x, LEFT_TOP_OF_GZD.y);

                ctx.lineTo(LEFT_BOTTOM_OF_GZD.x, LEFT_BOTTOM_OF_GZD.y);

                ctx.moveTo(RIGHT_TOP_OF_GZD.x, LEFT_BOTTOM_OF_GZD.y);

                ctx.lineTo(RIGHT_TOP_OF_GZD.x, canvasBottom.y);
            } else if (
                // Modified vertical only
                latTop <= TOP_OF_V_SERIES_GZD &&
                latBottom >= BOTTOM_OF_V_SERIES_GZD
            ) {
                ctx.moveTo(LEFT_TOP_OF_GZD.x, canvasTop.y);

                ctx.lineTo(LEFT_BOTTOM_OF_GZD.x, canvasBottom.y);
            }
        } else if (tick === 12) {
            if (latTop > TOP_OF_W_SERIES_GZD && latTop <= 84) {
                // Handle Svalbard
                const TOP_LEFT_OF_33X_GZD = latLngToContainerPoint({
                    lat: latTop,
                    lng: 9,
                }, state, srWGS84);
                ctx.moveTo(TOP_LEFT_OF_33X_GZD.x, TOP_LEFT_OF_33X_GZD.y);

                const BOTTOM_LEFT_OF_33X_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: 9,
                }, state, srWGS84);

                ctx.lineTo(BOTTOM_LEFT_OF_33X_GZD.x, BOTTOM_LEFT_OF_33X_GZD.y);

                const TOP_RIGHT_OF_32W_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: tick,
                }, state, srWGS84);

                ctx.moveTo(TOP_RIGHT_OF_32W_GZD.x, TOP_RIGHT_OF_32W_GZD.y);

                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            } else {
                // Normal use case
                ctx.moveTo(canvasTop.x, canvasTop.y);
                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            }
        } else if (tick === 18) {
            // Do not draw through Svalbard
            if (latTop > TOP_OF_W_SERIES_GZD) {
                const TOP_LEFT_OF_34_SERIES_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: tick,
                }, state, srWGS84);
                ctx.moveTo(TOP_LEFT_OF_34_SERIES_GZD.x, TOP_LEFT_OF_34_SERIES_GZD.y);
            } else {
                ctx.moveTo(canvasTop.x, canvasTop.y);
            }
            ctx.lineTo(canvasBottom.x, canvasBottom.y);
        } else if (tick === 24) {
            if (latTop > TOP_OF_W_SERIES_GZD && latTop <= 84) {
                // Handle Svalbard
                const TOP_LEFT_OF_35X_GZD = latLngToContainerPoint({
                    lat: latTop,
                    lng: 21,
                }, state, srWGS84);
                ctx.moveTo(TOP_LEFT_OF_35X_GZD.x, TOP_LEFT_OF_35X_GZD.y);

                const BOTTOM_LEFT_OF_35X_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: 21,
                }, state, srWGS84);

                ctx.lineTo(BOTTOM_LEFT_OF_35X_GZD.x, BOTTOM_LEFT_OF_35X_GZD.y);

                const TOP_RIGHT_OF_34W_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: tick,
                }, state, srWGS84);

                ctx.moveTo(TOP_RIGHT_OF_34W_GZD.x, TOP_RIGHT_OF_34W_GZD.y);

                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            } else {
                // Normal use case
                ctx.moveTo(canvasTop.x, canvasTop.y);
                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            }
        } else if (tick === 30) {
            // Do not draw through Svalbard
            if (latTop > TOP_OF_W_SERIES_GZD) {
                const TOP_LEFT_OF_35_SERIES_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: tick,
                }, state, srWGS84);
                ctx.moveTo(TOP_LEFT_OF_35_SERIES_GZD.x, TOP_LEFT_OF_35_SERIES_GZD.y);
            } else {
                ctx.moveTo(canvasTop.x, canvasTop.y);
            }
            ctx.lineTo(canvasBottom.x, canvasBottom.y);
        } else if (tick === 36) {
            if (latTop > TOP_OF_W_SERIES_GZD && latTop <= 84) {
                // Handle Svalbard
                const TOP_LEFT_OF_37X_GZD = latLngToContainerPoint({
                    lat: latTop,
                    lng: 33,
                }, state, srWGS84);
                ctx.moveTo(TOP_LEFT_OF_37X_GZD.x, TOP_LEFT_OF_37X_GZD.y);

                const BOTTOM_LEFT_OF_37X_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: 33,
                }, state, srWGS84);

                ctx.lineTo(BOTTOM_LEFT_OF_37X_GZD.x, BOTTOM_LEFT_OF_37X_GZD.y);

                const TOP_RIGHT_OF_36W_GZD = latLngToContainerPoint({
                    lat: TOP_OF_W_SERIES_GZD,
                    lng: tick,
                }, state, srWGS84);

                ctx.moveTo(TOP_RIGHT_OF_36W_GZD.x, TOP_RIGHT_OF_36W_GZD.y);

                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            } else {
                // Normal use case
                ctx.moveTo(canvasTop.x, canvasTop.y);
                ctx.lineTo(canvasBottom.x, canvasBottom.y);
            }
        } else {
            ctx.moveTo(canvasTop.x, canvasTop.y);
            ctx.lineTo(canvasBottom.x, canvasBottom.y);
        }
        ctx.stroke();
        drawGzdLabels(tick, ctx, options, state, srWGS84);
    }

    function drawGzdLabels(longitude, ctx, options, state, srWGS84) {
        for (let labelLatitude = -76; labelLatitude < 84; labelLatitude += 8) {
            let labelLongitude;
            if (labelLatitude === 60) {
                if (longitude === 0) {
                    //31V
                    labelLongitude = 1.5;
                } else if (longitude === 6) {
                    //32V
                    labelLongitude = 7.5;
                } else {
                    labelLongitude = longitude + 3;
                }
            } else if (labelLatitude === 76) {
                if (longitude === 0) {
                    //31X
                    labelLongitude = 4.5;
                } else if (longitude === 12) {
                    //33X
                    labelLongitude = 15;
                } else if (longitude === 24) {
                    //35X
                    labelLongitude = 27;
                } else if (longitude === 36) {
                    //37X
                    labelLongitude = 37.5;
                } else {
                    labelLongitude = longitude + 3;
                }
            } else {
                // Rest of the world...
                labelLongitude = longitude + 3;
            }

            let gzdLabel;
            try {
                gzdLabel = coordinates.llToMgrs([labelLongitude, labelLatitude], 1).match(MGRS_REGEX)[GZD_INDEX];
            } catch (error) {
                return; //Invalid MGRS value returned, so no need to try to display a label
            }

            if (
                !(gzdLabel === '33X' && longitude === 6) &&
                !(gzdLabel === '35X' && longitude === 18) &&
                !(gzdLabel === '37X' && longitude === 30)
            ) {
                const labelXy = latLngToContainerPoint({
                    lat: labelLatitude,
                    lng: labelLongitude,
                }, state, srWGS84);

                commonUtils.drawLabel(ctx, gzdLabel, options.fontColor, options.color, labelXy);
            }
        }
    }

    function getVizGzds(extent) {
        const nw = new Point(extent.xmin, extent.ymax, extent.spatialReference);
        const ne = new Point(extent.xmax, extent.ymax, extent.spatialReference);
        const se = new Point(extent.xmax, extent.ymin, extent.spatialReference);
        const sw = new Point(extent.xmin, extent.ymin, extent.spatialReference);

        const nwMgrs = coordinates.llToMgrs([nw.longitude, nw.latitude], 1);
        const neMgrs = coordinates.llToMgrs([ne.longitude, ne.latitude], 1);
        const seMgrs = coordinates.llToMgrs([se.longitude, se.latitude], 1);
        const swMgrs = coordinates.llToMgrs([sw.longitude, sw.latitude], 1);

        let visibleGzds;
        try {
            visibleGzds = commonUtils.getAllVisibleGzds(
                nwMgrs.match(MGRS_REGEX)[GZD_INDEX],
                neMgrs.match(MGRS_REGEX)[GZD_INDEX],
                seMgrs.match(MGRS_REGEX)[GZD_INDEX],
                swMgrs.match(MGRS_REGEX)[GZD_INDEX]
            );
        } catch (e) {
            visibleGzds = null;
        }
        return visibleGzds;
    }

    function latLngToContainerPoint(gridIntersection, state, srWGS84) {
        const gridIntersectionPoint = new Point({
            x: gridIntersection.lng,
            y: gridIntersection.lat,
            spatialReference: srWGS84,
        });
        const wmPoint1 = webMercatorUtils.geographicToWebMercator(gridIntersectionPoint);
        const screenPoint = [0, 0];
        state.toScreen(screenPoint, wmPoint1.x, wmPoint1.y);
        return {
            y: screenPoint[1],
            x: screenPoint[0]
        };
    }

    function latLngToScreenPoint(gridIntersection, state, srWGS84) {
        const gridIntersectionPoint = new Point({
            x: gridIntersection.lng,
            y: gridIntersection.lat,
            spatialReference: srWGS84,
        });
        const wmPoint1 = webMercatorUtils.geographicToWebMercator(gridIntersectionPoint);
        const screenPoint = [0, 0];
        state.toScreen(screenPoint, wmPoint1.x, wmPoint1.y);
        return new Point({
            x: screenPoint[0],
            y: screenPoint[1],
            spatialReference: srWGS84,
        });
    }

    function drawLine(ctx, notHkLine, options) {
        if (notHkLine) {
            //  ctx.setLineDash(options.gridDashArray);
            //  ctx.lineWidth = options.weight + 1;
            //  ctx.lineCap = 'round';
            //  ctx.strokeStyle = options.gridFontColor;
            //  ctx.stroke();
            ctx.lineWidth = options.weight;
            ctx.lineCap = 'round';
            ctx.strokeStyle = options.gridColor;
            ctx.stroke();
        } else {
            ctx.lineWidth = options.weight;
            ctx.strokeStyle = options.hkColor;
            ctx.lineCap = 'round';
            ctx.setLineDash(options.hkDashArray);
            ctx.stroke();
        }
    }

    function getLabelText(element, mgrsGridInterval) {
        let label =
            mgrsGridInterval === 10000 || mgrsGridInterval === 1000
                ? ((element % 100000) / 1000).toString()
                : ((element % 100000) / 100).toString();

        if (mgrsGridInterval === 100) {
            label = label.padStart(3, '0');
        }

        return label;
    }

    return MgrsGraticuleLayer;
});
