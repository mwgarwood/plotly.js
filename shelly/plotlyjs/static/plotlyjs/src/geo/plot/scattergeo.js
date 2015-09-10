'use strict';

/* global d3:false */

var Plotly = require('../../plotly'),
    getTopojsonFeatures = require('../lib/topojson-utils').getTopojsonFeatures,
    locationToFeature = require('../lib/location-utils').locationToFeature;

var plotScatterGeo = module.exports = {};


plotScatterGeo.calcGeoJSON = function(trace, topojson) {
    var cdi = [],
        marker = trace.marker || {},
        hasLocationData = Array.isArray(trace.locations);

    var len, features, getLonLat, lonlat, locations;

    if(hasLocationData) {
        locations = trace.locations;
        len = locations.length;
        features = getTopojsonFeatures(trace, topojson);
        getLonLat = function(trace, i) {
            var feature = locationToFeature(trace.locationmode, locations[i], features);

            return (feature !== undefined) ?
                feature.properties.ct :
                undefined;
        };
    }
    else {
        len = trace.lon.length;
        getLonLat = function(trace, i) {
            return [trace.lon[i], trace.lat[i]];
        };
    }

    for(var i = 0; i < len; i++) {
        lonlat = getLonLat(trace, i);
        if(!lonlat) continue;

        cdi.push({
            lon: lonlat[0],
            lat: lonlat[1],
            location: hasLocationData ? trace.locations[i] : null
        });
    }

    if(cdi.length > 0) {
        cdi[0].trace = trace;
        Plotly.Lib.mergeArray(marker.size, cdi, 'ms');
        Plotly.Scatter.arraysToCalcdata(cdi);
    }

    return cdi;
};

function makeLineGeoJSON(trace) {
    var N = trace.lon.length,
        coordinates = new Array(N);

    for (var i = 0; i < N; i++) {
        coordinates[i] = [trace.lon[i], trace.lat[i]];
    }

    return {
        type: 'LineString',
        coordinates: coordinates,
        trace: trace
    };
}

plotScatterGeo.plot = function(geo, scattergeoData) {
    var gScatterGeo = geo.framework.select('g.scattergeolayer'),
        Scatter = Plotly.Scatter,
        topojson = geo.topojson;

    // TODO move to more d3-idiomatic pattern (that's work on replot)
    // N.B. html('') does not work in IE11
    gScatterGeo.selectAll('*').remove();

    var gScatterGeoTraces = gScatterGeo
        .selectAll('g.trace.scatter')
        .data(scattergeoData);

    gScatterGeoTraces.enter().append('g')
            .attr('class', 'trace scattergeo');

    // TODO add hover - how?
    gScatterGeoTraces
        .each(function(trace) {
            if(!Scatter.hasLines(trace) || trace.visible !== true) return;
            d3.select(this)
                .append('path')
                .datum(makeLineGeoJSON(trace))
                .attr('class', 'js-line');
        });

    gScatterGeoTraces.append('g')
        .attr('class', 'points')
        .each(function(trace) {
            var s = d3.select(this),
                showMarkers = Scatter.hasMarkers(trace),
                showText = Scatter.hasText(trace);

            if((!showMarkers && !showText) || trace.visible !== true) {
                s.remove();
                return;
            }

           var cdi = plotScatterGeo.calcGeoJSON(trace, topojson),
               cleanHoverLabelsFunc = makeCleanHoverLabelsFunc(geo, trace);

            var hoverinfo = trace.hoverinfo,
                hasNameLabel = (hoverinfo === 'all' ||
                    hoverinfo.indexOf('name') !== -1);

            function handleMouseOver(d) {
                if(!geo.showHover) return;

                var xy = geo.projection([d.lon, d.lat]);
                cleanHoverLabelsFunc(d);

                Plotly.Fx.loneHover({
                    x: xy[0],
                    y: xy[1],
                    name: hasNameLabel ? trace.name : undefined,
                    text: d.textLabel,
                    color: d.mc || (trace.marker || {}).color
                }, {
                    container: geo.hoverContainer.node()
                });
            }

            if(showMarkers) {
                s.selectAll('path.point')
                    .data(cdi)
                    .enter().append('path')
                        .attr('class', 'point')
                        .on('mouseover', handleMouseOver)
                        .on('mouseout', function() {
                            Plotly.Fx.loneUnhover(geo.hoverContainer);
                        })
                        .on('mousedown', function() {
                            // to simulate the 'zoomon' event
                            Plotly.Fx.loneUnhover(geo.hoverContainer);
                        })
                        .on('mouseup', handleMouseOver);  // ~ 'zoomend'
            }

            if(showText) {
                s.selectAll('g')
                    .data(cdi)
                    .enter().append('g')
                        .append('text');
            }
        });

    plotScatterGeo.style(geo);
};

plotScatterGeo.style = function(geo) {
    var selection = geo.framework.selectAll('g.trace.scattergeo');

    selection.style('opacity', function(trace) { return trace.opacity; });

    selection.selectAll('g.points')
        .each(function(trace){
            d3.select(this).selectAll('path.point')
                .call(Plotly.Drawing.pointStyle, trace);
            d3.select(this).selectAll('text')
                .call(Plotly.Drawing.textPointStyle, trace);
        });

    // GeoJSON calc data is incompatible with Plotly.Drawing.lineGroupStyle
    selection.selectAll('path.js-line')
        .style('fill', 'none')
        .each(function(d) {
            var trace = d.trace,
                line = trace.line || {};

            d3.select(this)
                .call(Plotly.Color.stroke, line.color)
                .call(Plotly.Drawing.dashLine, line.dash || '', line.width || 0);
        });
};

function makeCleanHoverLabelsFunc(geo, trace) {
    var hoverinfo = trace.hoverinfo;

    if(hoverinfo === 'none') {
        return function cleanHoverLabelsFunc(d) { delete d.textLabel; };
    }

    var hoverinfoParts = (hoverinfo === 'all') ?
        Plotly.ScatterGeo.attributes.hoverinfo.flags :
        hoverinfo.split('+');

    var hasLocation = (hoverinfoParts.indexOf('location') !== -1 &&
           Array.isArray(trace.locations)),
        hasLon = (hoverinfoParts.indexOf('lon') !== -1),
        hasLat = (hoverinfoParts.indexOf('lat') !== -1),
        hasText = (hoverinfoParts.indexOf('text') !== -1);

    function formatter(val) {
        return Plotly.Axes.tickText(geo.mockAxis, val, 'hover').text + '\u00B0';
    }

    return function cleanHoverLabelsFunc(d) {
        var thisText = [];

        if(hasLocation) thisText.push(d.location);
        else if(hasLon && hasLat) {
            thisText.push('(' + formatter(d.lon) + ', ' + formatter(d.lat) + ')');
        }
        else if(hasLon) thisText.push('lon: ' + formatter(d.lon));
        else if(hasLat) thisText.push('lat: ' + formatter(d.lat));

        if(hasText) thisText.push(d.tx || trace.text);

        d.textLabel = thisText.join('<br>');
    };
}
