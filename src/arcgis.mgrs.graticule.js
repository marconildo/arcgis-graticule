
define([
    "esri/layers/Layer",
    "esri/geometry/Point",
    "esri/geometry/Extent",
    "esri/geometry/support/webMercatorUtils",
    "esri/geometry/geometryEngine",
    "esri/views/2d/layers/BaseLayerView2D",
    "esri/geometry/SpatialReference",
    "esri/geometry/projection",
    "../src/utils/commonUtils.js",
    "../src/utils/coordinates.js",
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

            if (!mgrsGridInterval) {
                return;
            }

            drawGrid(ctx, state, srWGS84, extentWGS84, mgrsGridInterval, options, zoom);
            drawGzd(ctx, state, srWGS84, extentWGS84, options, zoom);
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
                    dashArray: [6, 6],
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

    function getVizGzds(extent) {
        const nw = extent.center;
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
            ctx.setLineDash(options.gridDashArray);
            ctx.lineWidth = options.weight + 1;
            ctx.strokeStyle = options.gridFontColor;
            ctx.stroke();
            ctx.lineWidth = options.weight;
            ctx.strokeStyle = options.gridColor;
            ctx.stroke();
        } else {
            ctx.lineWidth = options.weight;
            ctx.strokeStyle = options.hkColor;
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