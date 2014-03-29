var fs = require('fs'),
    Canvas = require('canvas'),
    Image = Canvas.Image,
    imagelib = require('./android-studio/imagelib/imagelib')
var window = {};
imagelib.ALLOW_MANUAL_RESCALE = true;

var GRID_SIZE_PIXELS = 4;
var SLOP_PIXELS = 10;

var autoFindRegions = function(){
    var srcData = stage.srcCtx.getImageData(0, 0, stage.srcSize.w, stage.srcSize.h);

    function _getPixel(x, y) {
        return (srcData.data[(y * stage.srcSize.w + x) * 4 + 0] << 16) // r
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 1] << 8) // g
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 2] << 0) // b
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 3] << 24); // a
    }

    // Finds ranges of equal values within an array
    function _getEqualRanges(arr) {
        var equalRanges = [];
        var start = -1;
        var startVal = 0;
        for (var i = 0; i < arr.length; i++) {
            if (start < 0) {
                start = i;
                startVal = arr[i];
            } else if (arr[i] != startVal) {
                if (start != i - 1) {
                    equalRanges.push({start: start, length: i - start});
                }

                start = i;
                startVal = arr[i];
            }
        }
        if (start != arr.length - 1) {
            equalRanges.push({start: start, length: arr.length - start});
        }
        return equalRanges.sort(function(x, y){ return y.length - x.length; });
    }

    var x, y;

    // First find optical bounds
    // This works by taking an alpha value histogram and finding two maxima to determine
    // low and high alphas.
    var alphaHistogram = [];
    for (x = 0; x < stage.srcSize.w; x++) {
        for (y = 0; y < stage.srcSize.h; y++) {
            var alpha = srcData.data[(y * stage.srcSize.w + x) * 4 + 3];
            alphaHistogram[alpha] = alphaHistogram[alpha] ? alphaHistogram[alpha] + 1 : 1;
        }
    }
    var max1 = 0, max1Freq = 0, max2 = 0, max2Freq = 0;
    for (var i = 0; i < 256; i++) {
        if (alphaHistogram[i] > max1Freq) {
            max2 = max1;
            max2Freq = max1Freq;
            max1 = i;
            max1Freq = alphaHistogram[i];
        } else if (alphaHistogram[i] > max2Freq) {
            max2 = i;
            max2Freq = alphaHistogram[i];
        }
    }
    var alphaMin = (max1 < max2) ? max1 : max2;
    var alphaMax = (max1 > max2) ? max1 : max2;
    var ALPHA_THRESHOLD = 5;
    window.alphaHistogram = alphaHistogram;

    var opticalBoundsRect = {l:-1, r:-1, t:-1, b:-1};
    // Find left optical bound
    obrLeft:
        for (x = 0; x < stage.srcSize.w; x++) {
            for (y = 0; y < stage.srcSize.h; y++) {
                var alpha = srcData.data[(y * stage.srcSize.w + x) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    opticalBoundsRect.l = x;
                    break obrLeft;
                }
            }
        }
    // Find right optical bound
    obrRight:
        for (x = stage.srcSize.w - 1; x >= 0; x--) {
            for (y = 0; y < stage.srcSize.h; y++) {
                var alpha = srcData.data[(y * stage.srcSize.w + x) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    opticalBoundsRect.r = x;
                    break obrRight;
                }
            }
        }
    // Find top optical bound
    obrTop:
        for (y = 0; y < stage.srcSize.h; y++) {
            for (x = 0; x < stage.srcSize.w; x++) {
                var alpha = srcData.data[(y * stage.srcSize.w + x) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    opticalBoundsRect.t = y;
                    break obrTop;
                }
            }
        }
    // Find bottom optical bound
    obrBottom:
        for (y = stage.srcSize.h - 1; y >= 0; y--) {
            for (x = 0; x < stage.srcSize.w; x++) {
                var alpha = srcData.data[(y * stage.srcSize.w + x) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    opticalBoundsRect.b = y;
                    break obrBottom;
                }
            }
        }
    if (opticalBoundsRect.l >= 0 && opticalBoundsRect.r > opticalBoundsRect.l
        && opticalBoundsRect.t >= 0 && opticalBoundsRect.b > opticalBoundsRect.t) {
        var rect = {
            x: opticalBoundsRect.l,
            y: opticalBoundsRect.t,
            w: opticalBoundsRect.r - opticalBoundsRect.l + 1,
            h: opticalBoundsRect.b - opticalBoundsRect.t + 1
        };
        if (stage.editMode == 'opticalbounds') {
            stage.opticalBoundsRect = rect;
        } else if (stage.editMode == 'padding') {
            stage.contentRect = rect;
        }
    }

    // Next find stretch regions. Only use them if they're within the optical bounds
    if (stage.editMode == 'stretch') {
        var summer = new imagelib.util.Summer();
        var sums = [];
        for (y = 0; y < stage.srcSize.h; y++) {
            // Compute row
            summer.reset();
            for (var x = 0; x < stage.srcSize.w; x++) {
                summer.addNext(_getPixel(x, y));
            }
            sums.push(summer.compute());
        }
        var ranges = _getEqualRanges(sums);
        for (var i = 0; i < ranges.length; i++) {
            var range = ranges[i];
            var passesThreshold = false;
            // Check if this row has a minimum alpha
            for (x = 0; x < stage.srcSize.w; x++) {
                var alpha = srcData.data[(range.start * stage.srcSize.w + x) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    passesThreshold = true;
                    break;
                }
            }
            if (passesThreshold) {
                stage.stretchRect.y = range.start;
                stage.stretchRect.h = range.length;
                if (range.length >= 4) {
                    // inset a bit to prevent scaling artifacts
                    stage.stretchRect.y++;
                    stage.stretchRect.h -= 2;
                }
                break;
            }
        }

        summer.reset();
        sums = [];
        for (x = 0; x < stage.srcSize.w; x++) {
            // Compute column
            summer.reset();
            for (y = 0; y < stage.srcSize.h; y++) {
                summer.addNext(_getPixel(x, y));
            }
            sums.push(summer.compute());
        }
        ranges = _getEqualRanges(sums);
        for (var i = 0; i < ranges.length; i++) {
            var range = ranges[i];
            var passesThreshold = false;
            // Check if this column has a minimum alpha
            for (y = 0; y < stage.srcSize.h; y++) {
                var alpha = srcData.data[(y * stage.srcSize.w + range.start) * 4 + 3];
                if (alpha >= alphaMax - ALPHA_THRESHOLD) {
                    passesThreshold = true;
                    break;
                }
            }
            if (passesThreshold) {
                stage.stretchRect.x = range.start;
                stage.stretchRect.w = range.length;
                if (range.length >= 4) {
                    // inset a bit to prevent scaling artifacts
                    stage.stretchRect.x++;
                    stage.stretchRect.w -= 2;
                }
                break;
            }
        }
    }
};

var stage = {
    zoom: 1,
    gridColor: 'light',
    editMode: 'stretch',
    stretchRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0
    },
    contentRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0
    },
    opticalBoundsRect: {
        x: 0,
        y: 0,
        w: 0,
        h: 0
    },
    name: 'default'
};

var resetStage = function (newCtx, initStage) {
    stage.srcCtx = newCtx;
    console.log('setting stage to ', newCtx);
    console.log('init stage', initStage);
    stage.srcSize = {
        w: stage.srcCtx.canvas.width,
        h: stage.srcCtx.canvas.height
    };

    // Compute a zoom level that'll show the stage as large as possible
    stage.zoom = Math.max(1, Math.floor(500 / Math.max(stage.srcSize.w, stage.srcSize.h)));
    stage.size = {
        w: stage.srcSize.w * stage.zoom,
        h: stage.srcSize.h * stage.zoom
    };


    // Create a nearest-neighbor scaled-up copy of the source image for the stage
    stage.previewCtx = imagelib.drawing.context(stage.size);
    var srcData = stage.srcCtx.getImageData(0, 0, stage.srcSize.w, stage.srcSize.h);
    var previewData = stage.previewCtx.createImageData(stage.size.w, stage.size.h);
    var sx, sy;
    for (var y = 0; y < stage.size.h; y++) {
        for (var x = 0; x < stage.size.w; x++) {
            sx = Math.floor(x * stage.srcSize.w / stage.size.w);
            sy = Math.floor(y * stage.srcSize.h / stage.size.h);
            previewData.data[(y * stage.size.w + x) * 4 + 0] =
                srcData.data[(sy * stage.srcSize.w + sx) * 4 + 0];
            previewData.data[(y * stage.size.w + x) * 4 + 1] =
                srcData.data[(sy * stage.srcSize.w + sx) * 4 + 1];
            previewData.data[(y * stage.size.w + x) * 4 + 2] =
                srcData.data[(sy * stage.srcSize.w + sx) * 4 + 2];
            previewData.data[(y * stage.size.w + x) * 4 + 3] =
                srcData.data[(sy * stage.srcSize.w + sx) * 4 + 3];
        }
    }
    stage.previewCtx.putImageData(previewData, 0, 0);

    // Reset the stretch, padding/content, and optical bounds regions
    stage.stretchRect = initStage.stretchRect || {
        x: Math.floor(stage.srcSize.w / 3),
        y: Math.floor(stage.srcSize.h / 3),
        w: Math.ceil(stage.srcSize.w / 3),
        h: Math.ceil(stage.srcSize.h / 3)
    };

    stage.contentRect = initStage.contentRect || { x: 0, y: 0, w: stage.srcSize.w, h: stage.srcSize.h };
    stage.opticalBoundsRect = initStage.opticalBoundsRect || { x: 0, y: 0, w: stage.srcSize.w, h: stage.srcSize.h };
    // Create the stage canvas
    stage.canvas = new Canvas(stage.size.w, stage.size.h);
//    if (!initStage.stretchRect) {
//        loadStage();
//        console.log('afterloadstage');
//        console.log('stage.stretchRect',stage.stretchRect)
//        console.log('stage.contentRect',stage.contentRect)
//        console.log('stage.opticalBoundsRect',stage.opticalBoundsRect)
//
//    }
};
var trimStretch = function(){
    stage.editMode = 'stretch';
    autoFindRegions();
    var srcData = stage.srcCtx.getImageData(0, 0, stage.srcSize.w, stage.srcSize.h);
    console.log('stage.stretchRect',stage.stretchRect)
    console.log('stage.contentRect',stage.contentRect)
    console.log('stage.opticalBoundsRect',stage.opticalBoundsRect)

    function _getPixel(x, y) {
        return (srcData.data[(y * stage.srcSize.w + x) * 4 + 0] << 16) // r
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 1] << 8) // g
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 2] << 0) // b
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 3] << 24); // a
    }

    var collapseX = stage.stretchRect.w > 4; // generally going to start as true
    var collapseY = stage.stretchRect.h > 4; // generally going to start as true
    var x, y;

    // See if collapse is possible in either direction by comparing row/column sums.
    var summer = new imagelib.util.Summer();
    console.log('stage.stretchRect',stage.stretchRect)
    console.log('stage.contentRect',stage.contentRect)
    console.log('stage.opticalBoundsRect',stage.opticalBoundsRect)

    // See if can be horizontally collapsed.
    var first = true;
    var firstSum = -1;
    for (x = stage.stretchRect.x; x < (stage.stretchRect.x + stage.stretchRect.w); x++) {
        // Compute column
        summer.reset();
        for (y = 0; y < stage.srcSize.h; y++) {
            summer.addNext(_getPixel(x, y));
        }
        if (first) {
            firstSum = summer.compute();
            first = false;
        } else if (summer.compute() != firstSum) {
            collapseX = false;
            break;
        }
    }
    first = true;
    for (y = stage.stretchRect.y; y < (stage.stretchRect.y + stage.stretchRect.h); y++) {
        // Compute row
        summer.reset();
        for (x = 0; x < stage.srcSize.w; x++) {
            summer.addNext(_getPixel(x, y));
        }
        if (first) {
            firstSum = summer.compute();
            first = false;
        } else if (summer.compute() != firstSum) {
            collapseY = false;
            break;
        }
    }

    if (!collapseX && !collapseY) {
        // No-op
        console.log('no-op')
        return;
    }

    var fixed = {
        l: stage.stretchRect.x,
        t: stage.stretchRect.y,
        r: stage.srcSize.w - stage.stretchRect.x - stage.stretchRect.w,
        b: stage.srcSize.h - stage.stretchRect.y - stage.stretchRect.h
    };

    var middle = {
        w: collapseX ? 4 : stage.stretchRect.w,
        h: collapseY ? 4 : stage.stretchRect.h
    };

    var size = {
        w: fixed.l + middle.w + fixed.r,
        h: fixed.t + middle.h + fixed.b
    };

    // Redraw components
    var ctx = imagelib.drawing.context(size);

    // TL
    if (fixed.l && fixed.t)
        ctx.drawImage(stage.srcCtx.canvas,
            0, 0, fixed.l, fixed.t,
            0, 0, fixed.l, fixed.t);

    // BL
    if (fixed.l && fixed.b)
        ctx.drawImage(stage.srcCtx.canvas,
            0, stage.srcSize.h - fixed.b, fixed.l, fixed.b,
            0, size.h - fixed.b, fixed.l, fixed.b);

    // TR
    if (fixed.r && fixed.t)
        ctx.drawImage(stage.srcCtx.canvas,
            stage.srcSize.w - fixed.r, 0, fixed.r, fixed.t,
            size.w - fixed.r, 0, fixed.r, fixed.t);

    // BR
    if (fixed.r && fixed.b)
        ctx.drawImage(stage.srcCtx.canvas,
            stage.srcSize.w - fixed.r, stage.srcSize.h - fixed.b, fixed.r, fixed.b,
            size.w - fixed.r, size.h - fixed.b, fixed.r, fixed.b);

    // Top
    if (fixed.t)
        ctx.drawImage(stage.srcCtx.canvas,
            fixed.l, 0, stage.stretchRect.w, fixed.t,
            fixed.l, 0, size.w - fixed.l - fixed.r, fixed.t);

    // Left
    if (fixed.l)
        ctx.drawImage(stage.srcCtx.canvas,
            0, fixed.t, fixed.l, stage.stretchRect.h,
            0, fixed.t, fixed.l, size.h - fixed.t - fixed.b);

    // Right
    if (fixed.r)
        ctx.drawImage(stage.srcCtx.canvas,
            stage.srcSize.w - fixed.r, fixed.t, fixed.r, stage.stretchRect.h,
            size.w - fixed.r, fixed.t, fixed.r, size.h - fixed.t - fixed.b);

    // Bottom
    if (fixed.b)
        ctx.drawImage(stage.srcCtx.canvas,
            fixed.l, stage.srcSize.h - fixed.b, stage.stretchRect.w, fixed.b,
            fixed.l, size.h - fixed.b, size.w - fixed.l - fixed.r, fixed.b);

    // Middle
    ctx.drawImage(stage.srcCtx.canvas,
        fixed.l, fixed.t, stage.stretchRect.w, stage.stretchRect.h,
        fixed.l, fixed.t, size.w - fixed.l - fixed.r, size.h - fixed.t - fixed.b);

    var initStage = {
        stretchRect: {
            x: stage.stretchRect.x,
            y: stage.stretchRect.y,
            w: middle.w,
            h: middle.h
        },
        contentRect: {
            x: stage.contentRect.x,
            y: stage.contentRect.y,
            w: stage.contentRect.w + middle.w - stage.stretchRect.w,
            h: stage.contentRect.h + middle.h - stage.stretchRect.h
        },
        opticalBoundsRect: {
            x: stage.opticalBoundsRect.x,
            y: stage.opticalBoundsRect.y,
            w: stage.opticalBoundsRect.w + middle.w - stage.stretchRect.w,
            h: stage.opticalBoundsRect.h + middle.h - stage.stretchRect.h
        }
    };

    stage.name = stage.name + '-STRETCH_TRIMMED';

    resetStage(ctx, initStage);
    console.log('stage.stretchRect',stage.stretchRect)
    console.log('stage.contentRect',stage.contentRect)
    console.log('stage.opticalBoundsRect',stage.opticalBoundsRect)

};
var trimEdge = function () {
    var srcData = stage.srcCtx.getImageData(0, 0, stage.srcSize.w, stage.srcSize.h);

    function _getPixel(x, y) {
        return (srcData.data[(y * stage.srcSize.w + x) * 4 + 0] << 16) // r
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 1] << 8) // g
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 2] << 0) // b
            + (srcData.data[(y * stage.srcSize.w + x) * 4 + 3] << 24); // a
    }

    // Always trim by top-left pixel
    var trimPixel = _getPixel(0, 0);
    var insetRect = {l: 0, t: 0, r: 0, b: 0};
    var x, y;

    // Trim top
    trimTop:
        for (y = 0; y < stage.srcSize.h; y++) {
            for (x = 0; x < stage.srcSize.w; x++) {
                if (_getPixel(x, y) != trimPixel) {
                    break trimTop;
                }
            }
        }
    insetRect.t = y;
    // Trim left
    trimLeft:
        for (x = 0; x < stage.srcSize.w; x++) {
            for (y = 0; y < stage.srcSize.h; y++) {
                if (_getPixel(x, y) != trimPixel) {
                    break trimLeft;
                }
            }
        }
    insetRect.l = x;
    // Trim bottom
    trimBottom:
        for (y = stage.srcSize.h - 1; y >= 0; y--) {
            for (x = 0; x < stage.srcSize.w; x++) {
                if (_getPixel(x, y) != trimPixel) {
                    break trimBottom;
                }
            }
        }
    insetRect.b = stage.srcSize.h - y - 1;
    // Trim right
    trimRight:
        for (x = stage.srcSize.w - 1; x >= 0; x--) {
            for (y = 0; y < stage.srcSize.h; y++) {
                if (_getPixel(x, y) != trimPixel) {
                    break trimRight;
                }
            }
        }
    insetRect.r = stage.srcSize.w - x - 1;

    if (insetRect.l <= 0 && insetRect.t <= 0 && insetRect.r <= 0 && insetRect.b <= 0) {
        // No-op
        return;
    }

    // Build a new stage with inset values
    var size = {
        w: stage.srcSize.w - insetRect.l - insetRect.r,
        h: stage.srcSize.h - insetRect.t - insetRect.b
    };

    function _constrain(rect) {
        if (rect.x < 0) {
            rect.w += rect.x;
            rect.x += -rect.x;
        }
        if (rect.x + rect.w > size.w) {
            rect.w = size.w - rect.x;
        }
        if (rect.y < 0) {
            rect.h += rect.y;
            rect.y += -rect.y;
        }
        if (rect.y + rect.h > size.h) {
            rect.h = size.h - rect.y;
        }
        return rect;
    }

    var initStage = {
        contentRect: _constrain({
            x: stage.contentRect.x - insetRect.l,
            y: stage.contentRect.y - insetRect.t,
            w: stage.contentRect.w,
            h: stage.contentRect.h
        }),
        stretchRect: _constrain({
            x: stage.stretchRect.x - insetRect.l,
            y: stage.stretchRect.y - insetRect.t,
            w: stage.stretchRect.w,
            h: stage.stretchRect.h
        }),
        opticalBoundsRect: _constrain({
            x: stage.opticalBoundsRect.x - insetRect.l,
            y: stage.opticalBoundsRect.y - insetRect.t,
            w: stage.opticalBoundsRect.w,
            h: stage.opticalBoundsRect.h
        })
    };

    stage.name = stage.name + '-EDGES_TRIMMED';
    console.log(stage.name);
    var newCtx = imagelib.drawing.context(size);
    newCtx.drawImage(stage.srcCtx.canvas,
        insetRect.l, insetRect.t, size.w, size.h,
        0, 0, size.w, size.h);
    resetStage(newCtx, initStage);
}


fs.readFile(__dirname + '/green_button.png', function (err, imageData) {

    if (err) throw err;
    var img = new Image();
    img.src = imageData;
    var canvas = new Canvas(img.width, img.height);
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, img.width, img.height);

    resetStage(ctx, {});

    trimStretch();

    stage.srcCtx.canvas.pngStream().pipe(fs.createWriteStream(__dirname + '/out.png'));

});