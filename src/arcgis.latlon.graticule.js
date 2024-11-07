define([
    "esri/layers/Layer",
    "esri/geometry/Point",
    "esri/geometry/Extent",
    "esri/geometry/support/webMercatorUtils",
    "esri/views/2d/layers/BaseLayerView2D",
    "esri/geometry/SpatialReference",
    "esri/geometry/projection"
], function (
    Layer,
    Point,
    Extent,
    webMercatorUtils,
    BaseLayerView2D,
    SpatialReference,
    projection
) {
    const defaultLatLngInterval = [
        20, //0
        20, //1
        20, //2
        20, //3
        10, //4
        10, //5
        5, //6
        5, //7
        1, //8
        1, //9
        0.25, //10
        0.25, //11
        0.1, //12
        0.05, //13
        0.05, //14
        0.05, //15
        0.025, //16
        0.025, //17
        0.025, //18
    ];

    const LatLonGraticuleLayerView = BaseLayerView2D.createSubclass({
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

            const extent = this.view.extent;
            const zoom = Math.round(this.view.zoom)

            const currentLatLngInterval = defaultLatLngInterval[zoom] || 0.025
            const srWGS84 = new SpatialReference({ wkid: 4326 });
            const extentWGS84 = projection.project(extent, srWGS84);

            if (!extentWGS84) {
                return;
            }

            const startLat = Math.floor(extentWGS84.ymin / currentLatLngInterval) * currentLatLngInterval;
            const endLat = Math.ceil(extentWGS84.ymax / currentLatLngInterval) * currentLatLngInterval;

            const startLon = Math.floor(extentWGS84.xmin / currentLatLngInterval) * currentLatLngInterval;
            const endLon = Math.ceil(extentWGS84.xmax / currentLatLngInterval) * currentLatLngInterval;

            ctx.strokeStyle = this.layer.lineColor;
            ctx.lineWidth = this.layer.lineWeight;
            ctx.font = this.layer.fontType;
            ctx.fillStyle = this.layer.fontColor;

            // Desenhar linhas de latitude
            for (let lat = startLat; lat <= endLat; lat += currentLatLngInterval) {
                const startPoint = new Point({
                    x: extentWGS84.xmin,
                    y: lat,
                    spatialReference: srWGS84,
                });
                const endPoint = new Point({
                    x: extentWGS84.xmax,
                    y: lat,
                    spatialReference: srWGS84,
                });

                const wmPoint1 = webMercatorUtils.geographicToWebMercator(startPoint);
                const wmPoint2 = webMercatorUtils.geographicToWebMercator(endPoint);

                const screenPointStart = [0, 0];
                state.toScreen(screenPointStart, wmPoint1.x, wmPoint1.y);

                const screenPointEnd = [0, 0];
                state.toScreen(screenPointEnd, wmPoint2.x, wmPoint2.y);

                ctx.beginPath();
                ctx.moveTo(screenPointStart[0], screenPointStart[1]);
                ctx.lineTo(screenPointEnd[0], screenPointEnd[1]);
                ctx.stroke();

                // Desenhar rótulo
                const labelText = formatLatitude(lat);
                ctx.fillText(labelText, screenPointStart[0] + 5, screenPointStart[1] - 5);
            }

            // Desenhar linhas de longitude
            for (let lon = startLon; lon <= endLon; lon += currentLatLngInterval) {
                const startPoint = new Point({
                    x: lon,
                    y: extentWGS84.ymin,
                    spatialReference: srWGS84,
                });
                const endPoint = new Point({
                    x: lon,
                    y: extentWGS84.ymax,
                    spatialReference: srWGS84,
                });

                const wmPoint1 = webMercatorUtils.geographicToWebMercator(startPoint);
                const wmPoint2 = webMercatorUtils.geographicToWebMercator(endPoint);

                const screenPointStart = [0, 0];
                state.toScreen(screenPointStart, wmPoint1.x, wmPoint1.y);

                const screenPointEnd = [0, 0];
                state.toScreen(screenPointEnd, wmPoint2.x, wmPoint2.y);

                // Desenhar linha
                ctx.beginPath();
                ctx.moveTo(screenPointStart[0], screenPointStart[1]);
                ctx.lineTo(screenPointEnd[0], screenPointEnd[1]);
                ctx.stroke();

                // Desenhar rótulo
                const labelText = formatLongitude(lon);
                ctx.fillText(labelText, screenPointStart[0] + 5, screenPointStart[1] - 5);
            }
        },
        detach() {
        }
    });

    const LatLonGraticuleLayer = Layer.createSubclass({
        properties: {
            // Propriedades de estilo
            fontColor: { value: '#000' },
            fontBackground: { value: '#FFF' },
            lineColor: { value: '#000' },
            lineWeight: { value: 1 },
            fontType: { value: '12px Arial' },
        },
        constructor: (params) => {
        },
        createLayerView: function (view) {
            const layer = this;
            if (view.type === "2d") {
                return new LatLonGraticuleLayerView({
                    view: view,
                    layer: layer
                });
            }
        }
    });

    // Função para formatar a latitude
    function formatLatitude(lat) {
        if (lat === 0) {
            return '0°';
        } else if (lat > 0) {
            return lat.toFixed(3).replace(/(\.0+|0+)$/, '') + '°N';
        } else {
            return Math.abs(lat).toFixed(3).replace(/(\.0+|0+)$/, '') + '°S';
        }
    }

    // Função para formatar a longitude
    function formatLongitude(lon) {
        if (lon === 0) {
            return '0°';
        } else if (lon > 0) {
            return lon.toFixed(3).replace(/(\.0+|0+)$/, '') + '°E';
        } else {
            return Math.abs(lon).toFixed(3).replace(/(\.0+|0+)$/, '') + '°W';
        }
    }


    return LatLonGraticuleLayer;
});