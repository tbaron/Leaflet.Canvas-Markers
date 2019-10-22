"use strict";

(function(factory, window) {
    if (typeof define === "function" && define.amd) {
        // Define AMD module
        define(["leaflet", "rbush"], factory);
    } else if (typeof exports === "object") {
        // Define a Common JS module
        module.exports = factory(require("leaflet"), require("rbush"));
    }

    // Attach plugin to a global variable
    if (typeof window !== "undefined" && window.L && window.rbush) {
        window.L.CanvasIconLayer = factory(L, rbush);
    }
})(function(L, rbush) {
    var CanvasIconLayer = (L.Layer ? L.Layer : L.Class).extend({
        //Add event listeners to initialized section.
        initialize: function(options) {
            L.setOptions(this, options);
            this._onClickListeners = [];
            this._onHoverListeners = [];
            this._debug = options.debug;
        },

        setOptions: function(options) {
            L.setOptions(this, options);
            return this.redraw();
        },

        redraw: function() {
            this._redraw(true);
        },

        //Multiple layers at a time for rBush performance
        addMarkers: function(markers) {
            var self = this;
            var tmpMark = [];
            var tmpLatLng = [];

            markers.forEach(function(marker) {
                if (
                    !(
                        marker.options.pane === "markerPane" &&
                        marker.options.icon
                    )
                ) {
                    console.error("Layer isn't a marker");
                    return;
                }

                var latlng = marker.getLatLng();
                var isDisplaying = self._map.getBounds().contains(latlng);
                var s = self._addMarker(marker, latlng, isDisplaying);

                //Only add to Point Lookup if we are on map
                if (isDisplaying === true) tmpMark.push(s[0]);

                tmpLatLng.push(s[1]);
            });

            self._markers.load(tmpMark);
            self._latlngMarkers.load(tmpLatLng);
        },

        //Adds single layer at a time. Less efficient for rBush
        addMarker: function(marker) {
            var self = this;
            var latlng = marker.getLatLng();
            var isDisplaying = self._map.getBounds().contains(latlng);
            var dat = self._addMarker(marker, latlng, isDisplaying);

            //Only add to Point Lookup if we are on map
            if (isDisplaying === true) self._markers.insert(dat[0]);

            self._latlngMarkers.insert(dat[1]);
        },

        addLayer: function(layer) {
            if (layer.options.pane === "markerPane" && layer.options.icon)
                this.addMarker(layer);
            else console.error("Layer isn't a marker");
        },

        addLayers: function(layers) {
            this.addMarkers(layers);
        },

        removeLayer: function(layer) {
            this.removeMarker(layer, true);
        },

        removeMarker: function(marker, redraw) {
            var self = this;

            //If we are removed point
            if (marker["minX"]) marker = marker.data;

            var latlng = marker.getLatLng();
            var isDisplaying = self._map.getBounds().contains(latlng);

            var markerData = {
                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                data: marker
            };

            self._latlngMarkers.remove(markerData, function(a, b) {
                return a.data._leaflet_id === b.data._leaflet_id;
            });

            self._latlngMarkers.total--;
            self._latlngMarkers.dirty++;

            if (isDisplaying === true && redraw === true) {
                self._redraw(true);
            }
        },

        onAdd: function(map) {
            this._map = map;

            if (!this._canvas) this._initCanvas();

            if (this.options.pane) this.getPane().appendChild(this._canvas);
            else map._panes.overlayPane.appendChild(this._canvas);

            map.on("moveend", this._reset, this);
            map.on("resize", this._reset, this);

            map.on("click", this._executeListeners, this);
            map.on("mousemove", this._executeListeners, this);
        },

        onRemove: function(map) {
            if (this.options.pane) this.getPane().removeChild(this._canvas);
            else map.getPanes().overlayPane.removeChild(this._canvas);

            map.off("click", this._executeListeners, this);
            map.off("mousemove", this._executeListeners, this);

            map.off("moveend", this._reset, this);
            map.off("resize", this._reset, this);
        },

        addTo: function(map) {
            map.addLayer(this);
            return this;
        },

        clearLayers: function() {
            this._latlngMarkers = null;
            this._markers = null;
            this._redraw(true);
        },

        _addMarker: function(marker, latlng, isDisplaying) {
            var self = this;
            //Needed for pop-up & tooltip to work.
            marker._map = self._map;

            //_markers contains Points of markers currently displaying on map
            if (!self._markers) self._markers = new rbush();

            //_latlngMarkers contains Lat\Long coordinates of all markers in layer.
            if (!self._latlngMarkers) {
                self._latlngMarkers = new rbush();
                self._latlngMarkers.dirty = 0;
                self._latlngMarkers.total = 0;
            }

            L.Util.stamp(marker);

            var pointPos = self._map.latLngToContainerPoint(latlng);
            var iconSize = marker.options.icon.options.iconSize;

            var adj_x = iconSize[0] / 2;
            var adj_y = iconSize[1] / 2;
            var ret = [
                {
                    minX: pointPos.x - adj_x,
                    minY: pointPos.y - adj_y,
                    maxX: pointPos.x + adj_x,
                    maxY: pointPos.y + adj_y,
                    data: marker
                },
                {
                    minX: latlng.lng,
                    minY: latlng.lat,
                    maxX: latlng.lng,
                    maxY: latlng.lat,
                    data: marker
                }
            ];

            self._latlngMarkers.dirty++;
            self._latlngMarkers.total++;

            //Only draw if we are on map
            if (isDisplaying === true) self._drawMarker(marker, pointPos);

            return ret;
        },

        _drawMarker: function(marker, pointPos) {
            const self = this;

            if (!this._imageLookup) this._imageLookup = {};
            if (!pointPos) {
                pointPos = self._map.latLngToContainerPoint(marker.getLatLng());
            }

            const iconOptions = marker.options.icon.options;
            const iconUrl = iconOptions.iconUrl;
            const shadowUrl = iconOptions.shadowUrl;

            marker.hasShadow =
                shadowUrl && iconOptions.shadowSize && iconOptions.shadowAnchor;

            if (!self._imageLookup[iconUrl]) {
                self._loadImage(iconUrl);
            }
            marker._icon = self._imageLookup[iconUrl].image;

            let markerLoading = self._imageLookup[iconUrl].imageLoading;

            if (marker.hasShadow) {
                if (!self._imageLookup[shadowUrl]) {
                    self._loadImage(shadowUrl);
                }
                marker._shadowIcon = self._imageLookup[shadowUrl].image;

                markerLoading = Promise.all([
                    self._imageLookup[shadowUrl].imageLoading,
                    self._imageLookup[iconUrl].imageLoading
                ]);
            }

            markerLoading.then(() => {
                self._drawImage(marker, pointPos);
            });
        },

        _loadImage: function(url) {
            const imageElement = new Image();
            imageElement.src = url;

            this._imageLookup[url] = {
                image: imageElement,
                imageLoading: new Promise(resolve => {
                    imageElement.onload = () => {
                        resolve();
                    };
                })
            };

            return imageElement;
        },

        _drawImage: function(marker, pointPos) {
            const iconOptions = marker.options.icon.options;

            if (!iconOptions.iconAnchor) {
                iconOptions.iconAnchor = [0, 0];
            }

            const xImage = pointPos.x - iconOptions.iconAnchor[0];
            const yImage = pointPos.y - iconOptions.iconAnchor[1];

            if (this._debug) {
                const adj_x = iconOptions.iconSize[0] / 2;
                const adj_y = iconOptions.iconSize[1] / 2;

                this._context.fillRect(
                    pointPos.x - adj_x,
                    pointPos.y - adj_y,
                    2 * adj_x,
                    2 * adj_y
                );
            }

            this._context.drawImage(
                marker._icon,
                xImage,
                yImage,
                iconOptions.iconSize[0],
                iconOptions.iconSize[1]
            );

            if (marker.hasShadow) {
                this._context.drawImage(
                    marker._shadowIcon,
                    pointPos.x - iconOptions.shadowAnchor[0],
                    pointPos.y - iconOptions.shadowAnchor[1],
                    iconOptions.shadowSize[0],
                    iconOptions.shadowSize[1]
                );
            }

            const hasTooltip = marker.getTooltip();
            if (hasTooltip && hasTooltip.options.permanent) {
                let xDirectionOffset = 0;
                let yDirectionOffset = 0;
                let offset = hasTooltip.options.offset;

                switch (hasTooltip.options.direction) {
                    case "top":
                        yDirectionOffset = -iconOptions.iconSize[1];
                        break;
                    case "right":
                        xDirectionOffset = iconOptions.iconSize[0];
                        break;
                    case "bottom":
                        yDirectionOffset = iconOptions.iconSize[1];
                        break;
                    case "left":
                        xDirectionOffset = -iconOptions.iconSize[0];
                        break;
                }

                this._context.fillText(
                    hasTooltip._content,
                    xImage + xDirectionOffset + offset[0],
                    pointPos.y + yDirectionOffset + offset[1]
                );
            }
        },

        _reset: function() {
            var topLeft = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, topLeft);

            var size = this._map.getSize();

            this._canvas.width = size.x;
            this._canvas.height = size.y;

            this._redraw();
        },

        _redraw: function(clear) {
            var self = this;

            if (clear)
                this._context.clearRect(
                    0,
                    0,
                    this._canvas.width,
                    this._canvas.height
                );
            if (!this._map || !this._latlngMarkers) return;

            var tmp = [];

            //If we are 10% individual inserts\removals, reconstruct lookup for efficiency
            if (self._latlngMarkers.dirty / self._latlngMarkers.total >= 0.1) {
                self._latlngMarkers.all().forEach(function(e) {
                    tmp.push(e);
                });

                self._latlngMarkers.clear();
                self._latlngMarkers.load(tmp);
                self._latlngMarkers.dirty = 0;
                tmp = [];
            }

            var mapBounds = self._map.getBounds();

            //Only re-draw what we are showing on the map.

            var mapBoxCoords = {
                minX: mapBounds.getWest(),
                minY: mapBounds.getSouth(),
                maxX: mapBounds.getEast(),
                maxY: mapBounds.getNorth()
            };

            self._latlngMarkers.search(mapBoxCoords).forEach(function(e) {
                //Readjust Point Map
                var pointPos = self._map.latLngToContainerPoint(
                    e.data.getLatLng()
                );

                var iconSize = e.data.options.icon.options.iconSize;
                var adj_x = iconSize[0] / 2;
                var adj_y = iconSize[1] / 2;

                var newCoords = {
                    minX: pointPos.x - adj_x,
                    minY: pointPos.y - adj_y,
                    maxX: pointPos.x + adj_x,
                    maxY: pointPos.y + adj_y,
                    data: e.data
                };

                tmp.push(newCoords);

                //Redraw points
                self._drawMarker(e.data, pointPos);
            });

            //Clear rBush & Bulk Load for performance
            this._markers.clear();
            this._markers.load(tmp);
        },

        _initCanvas: function() {
            this._canvas = L.DomUtil.create(
                "canvas",
                "leaflet-canvas-icon-layer leaflet-layer"
            );

            var size = this._map.getSize();
            this._canvas.width = size.x;
            this._canvas.height = size.y;

            this._context = this._canvas.getContext("2d");

            var animated = this._map.options.zoomAnimation && L.Browser.any3d;
            L.DomUtil.addClass(
                this._canvas,
                "leaflet-zoom-" + (animated ? "animated" : "hide")
            );

            // Extracted from https://github.com/Sumbera/gLayers.Leaflet/
            /* L.CanvasLayer.js :
             Licensed under MIT
             Copyright (c) 2016 Stanislav Sumbera,
             http://blog.sumbera.com/2014/04/20/leaflet-canvas/

             Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
             (the "Software"), to deal in the Software without restriction, including without limitation the rights to use,
             copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
             and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

             The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

             THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
             INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
             IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
             WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
             OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
            */
            if (animated) {
                var that = this;
                this._map.on("zoomanim", function(e) {
                    var scale = that._map.getZoomScale(e.zoom);
                    // -- different calc of animation zoom  in leaflet 1.0.3 thanks @peterkarabinovic, @jduggan1
                    var offset = L.Layer
                        ? that._map._latLngBoundsToNewLayerBounds(
                              that._map.getBounds(),
                              e.zoom,
                              e.center
                          ).min
                        : that._map
                              ._getCenterOffset(e.center)
                              ._multiplyBy(-scale)
                              .subtract(that._map._getMapPanePos());

                    var pos = offset || new L.Point(0, 0);

                    that._canvas.style[L.DomUtil.TRANSFORM] =
                        (L.Browser.ie3d
                            ? "translate(" + pos.x + "px," + pos.y + "px)"
                            : "translate3d(" +
                              pos.x +
                              "px," +
                              pos.y +
                              "px,0)") + (scale ? " scale(" + scale + ")" : "");
                });
            }
        },

        addOnClickListener: function(listener) {
            this._onClickListeners.push(listener);
        },

        addOnHoverListener: function(listener) {
            this._onHoverListeners.push(listener);
        },

        _executeListeners: function(event) {
            if (!this._markers) return;

            var me = this;
            var x = event.containerPoint.x;
            var y = event.containerPoint.y;

            if (me._openToolTip) {
                me._openToolTip.closeTooltip();
                delete me._openToolTip;
            }

            var ret = this._markers.search({
                minX: x,
                minY: y,
                maxX: x,
                maxY: y
            });

            if (ret && ret.length > 0) {
                me._map._container.style.cursor = "pointer";

                if (event.type === "click") {
                    const hasPopup = ret[0].data.getPopup();
                    if (hasPopup) {
                        ret[0].data.openPopup();
                    }

                    me._onClickListeners.forEach(function(listener) {
                        listener(event, ret);
                    });
                }

                if (event.type === "mousemove") {
                    var hasTooltip = ret[0].data.getTooltip();
                    if (hasTooltip && !hasTooltip.options.permanent) {
                        me._openToolTip = ret[0].data;
                        ret[0].data.openTooltip();

                        me._onHoverListeners.forEach(function(listener) {
                            listener(event, ret);
                        });
                    }
                }
            } else {
                me._map._container.style.cursor = "";
            }
        }
    });

    L.canvasIconLayer = function(options) {
        return new CanvasIconLayer(options);
    };

    return L.canvasIconLayer;
}, window);
