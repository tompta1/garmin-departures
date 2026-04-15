using Toybox.Communications;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Position;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

class GarminDeparturesView extends WatchUi.View {
    private var _isLoading;
    private var _errorMessage;
    private var _stops;
    private var _groupIndex;
    private var _directionIndex;
    private var _scrollOffset;
    private var _maxScroll;
    private var _statusLine;
    private var _screenTimer;
    private var _cachedRowStep;

    function initialize() {
        View.initialize();
        _isLoading = false;
        _errorMessage = null;
        _stops = [];
        _groupIndex = 0;
        _directionIndex = 0;
        _scrollOffset = 0;
        _maxScroll = 0;
        _statusLine = "Klepnutim obnovite";
        _screenTimer = null;
        _cachedRowStep = 25;
    }

    function onShow() as Void {
        resetScreenTimer();
        if (_stops.size() == 0 && !_isLoading) {
            refresh();
        }
    }

    function onHide() as Void {
        stopScreenTimer();
    }

    // ── Screen-timeout helpers ───────────────────────────────────────────────

    // Public — called by delegate after every user interaction.
    // Returns to the watch face after 30 s of inactivity.
    function resetScreenTimer() as Void {
        stopScreenTimer();
        _screenTimer = new Timer.Timer();
        _screenTimer.start(method(:onScreenTimeout), 30000, false);
    }

    function stopScreenTimer() as Void {
        if (_screenTimer != null) {
            _screenTimer.stop();
            _screenTimer = null;
        }
    }

    function onScreenTimeout() as Void {
        _screenTimer = null;
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
    }

    function refresh() as Void {
        _isLoading = true;
        _errorMessage = null;
        _scrollOffset = 0;
        _maxScroll = 0;
        _statusLine = "Ziskavam polohu...";
        WatchUi.requestUpdate();

        try {
            var currentInfo = Position.getInfo();
            if (hasUsablePosition(currentInfo)) {
                onPosition(currentInfo);
                return;
            }
        } catch (e) {
        }

        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
    }

    function onPosition(info as Position.Info) as Void {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, null);
        if (!hasUsablePosition(info)) {
            onError("Poloha neni k dispozici");
            return;
        }

        var coords = info.position.toDegrees();
        _statusLine = "Nacitam odjezdy...";
        WatchUi.requestUpdate();

        Communications.makeWebRequest(
            GarminDeparturesConfig.API_URL,
            {
                "lat"    => coords[0],
                "lon"    => coords[1],
                "groups" => GarminDeparturesConfig.DEFAULT_GROUPS,
                "limit"  => GarminDeparturesConfig.DEFAULT_LIMIT,
                "modes"  => GarminDeparturesConfig.DEFAULT_MODES
            },
            {
                :method       => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onDeparturesResponse)
        );
    }

    function onDeparturesResponse(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        if (responseCode != 200 || data == null) {
            onError("Chyba HTTP " + responseCode);
            return;
        }

        try {
            var stops = data["stops"];
            if (stops == null || stops.size() == 0) {
                onError("Zadna blizka zastavka");
                return;
            }
            _stops = stops;
            _groupIndex = 0;
            _directionIndex = 0;
            _scrollOffset = 0;
            _maxScroll = 0;
            _isLoading = false;
            _errorMessage = null;
            _statusLine = "Klepnutim zmenite smer";
            resetScreenTimer();
            WatchUi.requestUpdate();
        } catch (e) {
            onError("Spatna odpoved serveru");
        }
    }

    function hasUsablePosition(info) {
        return info != null
            && info.position != null
            && info.accuracy != Position.QUALITY_NOT_AVAILABLE;
    }

    function onError(message as Lang.String) as Void {
        _isLoading = false;
        _errorMessage = message;
        _scrollOffset = 0;
        _maxScroll = 0;
        _statusLine = "Klepnutim obnovite";
        WatchUi.requestUpdate();
    }

    // ── Navigation API (called by delegate) ─────────────────────────────────

    function handleTap() {
        if (_isLoading || _errorMessage != null || _stops.size() == 0) {
            refresh();
            return true;
        }
        return toggleDirection();
    }

    function showNextStop() {
        if (_stops.size() <= 1) { return false; }
        _groupIndex = (_groupIndex + 1) % _stops.size();
        _directionIndex = 0;
        _scrollOffset = 0;
        WatchUi.requestUpdate();
        return true;
    }

    function showPreviousStop() {
        if (_stops.size() <= 1) { return false; }
        _groupIndex = (_groupIndex - 1 + _stops.size()) % _stops.size();
        _directionIndex = 0;
        _scrollOffset = 0;
        WatchUi.requestUpdate();
        return true;
    }

    function toggleDirection() {
        var directions = getCurrentDirections();
        if (directions == null || directions.size() <= 1) { return false; }
        _directionIndex = (_directionIndex + 1) % directions.size();
        _scrollOffset = 0;
        WatchUi.requestUpdate();
        return true;
    }

    function scrollDown() { return scrollBy(_cachedRowStep); }
    function scrollUp()   { return scrollBy(-_cachedRowStep); }

    function scrollBy(delta as Lang.Number) {
        if (_maxScroll <= 0) { return false; }
        var next = _scrollOffset + delta;
        if (next < 0) { next = 0; }
        if (next > _maxScroll) { next = _maxScroll; }
        if (next == _scrollOffset) { return false; }
        _scrollOffset = next;
        WatchUi.requestUpdate();
        return true;
    }

    // Called by delegate during live drag for smooth scrolling.
    function getScrollOffset() as Lang.Number {
        return _scrollOffset;
    }

    function setScrollOffset(offset as Lang.Number) as Void {
        var clamped = offset;
        if (clamped < 0) { clamped = 0; }
        if (_maxScroll > 0 && clamped > _maxScroll) { clamped = _maxScroll; }
        if (clamped != _scrollOffset) {
            _scrollOffset = clamped;
            WatchUi.requestUpdate();
        }
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var w = dc.getWidth();
        var h = dc.getHeight();

        // Screen shape: round displays need wider horizontal insets at
        // top/bottom to avoid the circular bezel eating into text.
        var shape = System.getDeviceSettings().screenShape;
        var isRound = (shape == System.SCREEN_SHAPE_ROUND
                    || shape == System.SCREEN_SHAPE_SEMI_ROUND);

        // ── Font tiers by screen height ──────────────────────────────────
        // 390–454 px  (Venu 3, Venu 3S, FR 965, Fenix 8, Epix 2 51mm …)
        // 260–390 px  (Venu 2, FR 265, Fenix 7, vivoactive 4 …)
        // < 260 px    (vivoactive 4S, FR 55, older Fenix …)
        var titleFont = Graphics.FONT_XTINY;
        var bodyFont  = Graphics.FONT_XTINY;
        var rowFont   = Graphics.FONT_XTINY;
        var tinyFont  = Graphics.FONT_XTINY;
        if (h >= 390) {
            titleFont = Graphics.FONT_SMALL;
            bodyFont  = Graphics.FONT_MEDIUM;
            rowFont   = Graphics.FONT_XTINY;
        } else if (h >= 260) {
            bodyFont  = Graphics.FONT_SMALL;
        }

        var titleH = dc.getFontHeight(titleFont);
        var bodyH  = dc.getFontHeight(bodyFont);
        var rowH   = dc.getFontHeight(rowFont);
        var tinyH  = dc.getFontHeight(tinyFont);

        // ── Layout margins ────────────────────────────────────────────────
        // Round displays need extra horizontal and vertical clearance near
        // the edges; rectangular ones use a small fixed margin.
        var hInset  = isRound
            ? (h >= 390 ? w * 14 / 100 : w * 9 / 100)
            : w * 3 / 100 + 3;
        var topPad  = isRound
            ? (h >= 390 ? h * 8 / 100 : h * 4 / 100)
            : h * 2 / 100 + 2;
        var botPad  = isRound
            ? (h >= 390 ? h * 9 / 100 : h * 5 / 100)
            : h * 2 / 100 + 2;
        var safeX = hInset;
        var safeW = w - hInset * 2;

        // ── Loading / error states ────────────────────────────────────────
        if (_isLoading) {
            var midY = h / 2 - bodyH / 2;
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            drawTickerInBox(dc, _statusLine, safeX, safeW, midY, bodyFont,
                            Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            drawPlainInBox(dc, "Klepnutim obnovite", safeX, safeW,
                           midY + bodyH + 4, tinyFont, Graphics.TEXT_JUSTIFY_CENTER);
            WatchUi.requestUpdate();
            return;
        }

        if (_errorMessage != null) {
            var midY = h / 2 - tinyH;
            dc.setColor(0xFF6666, Graphics.COLOR_TRANSPARENT);
            drawTickerInBox(dc, _errorMessage, safeX, safeW, midY, tinyFont,
                            Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            drawPlainInBox(dc, _statusLine, safeX, safeW,
                           midY + tinyH + 4, tinyFont, Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var group     = getCurrentGroup();
        var direction = getCurrentDirection();
        if (group == null || direction == null) {
            drawPlainInBox(dc, "Zadne odjezdy", safeX, safeW,
                           h / 2 - bodyH / 2, bodyFont, Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        // ── Header block ──────────────────────────────────────────────────
        var y = topPad;

        // Stop name (accent colour)
        dc.setColor(0x00CCFF, Graphics.COLOR_TRANSPARENT);
        drawTickerInBox(dc, group["name"], safeX, safeW, y, titleFont,
                        Graphics.TEXT_JUSTIFY_CENTER);
        y += titleH + 2;

        // Direction label
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        drawTickerInBox(dc, direction["label"], safeX, safeW, y, tinyFont,
                        Graphics.TEXT_JUSTIFY_CENTER);
        y += tinyH + 1;

        // Distance + platform
        var meta = direction["distanceMeters"] + " m";
        if (direction["platformCode"] != null) {
            meta = meta + "  ·  nastupiste " + direction["platformCode"];
        }
        dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
        drawTickerInBox(dc, meta, safeX, safeW, y, tinyFont,
                        Graphics.TEXT_JUSTIFY_CENTER);
        y += tinyH + 5;

        // Separator line
        dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(safeX, y, safeX + safeW, y);
        y += 4;

        // ── Departure list ────────────────────────────────────────────────
        var listTop    = y;
        var listBottom = h - botPad;
        var listHeight = listBottom - listTop;
        var rowStep    = rowH + 5;
        _cachedRowStep = rowStep;

        var departures = direction["departures"];
        if (departures == null) { departures = []; }

        var totalH = departures.size() * rowStep;
        var firstRow = listTop;

        var nextMaxScroll = totalH - listHeight;
        if (nextMaxScroll < 0) { nextMaxScroll = 0; }
        _maxScroll = nextMaxScroll;
        if (_scrollOffset > _maxScroll) { _scrollOffset = _maxScroll; }

        if (departures.size() == 0) {
            dc.setClip(safeX, listTop, safeW, listHeight);
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            drawPlainInBox(dc, "Zadne odjezdy v jiznim radu",
                           safeX, safeW, firstRow, tinyFont,
                           Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            var rowY = firstRow - _scrollOffset;
            var i    = 0;
            while (i < departures.size()) {
                // Only draw rows that intersect the visible list area.
                // drawDepartureRow clips each column to [listTop, listBottom]
                // directly, so no outer setClip is needed here.
                if (rowY + rowStep > listTop && rowY < listBottom) {
                    drawDepartureRow(dc, departures[i],
                                     safeX, safeW, rowY,
                                     rowFont, tinyFont, listTop, listHeight);
                }
                rowY += rowStep;
                i += 1;
            }
        }

        dc.setClip(0, 0, w, h);

        // ── Stop / direction counter at the very bottom ───────────────────
        // Centre the counter text within the botPad area so it has breathing
        // room below the clipped list and never overlaps the last row.
        var countY = listBottom + (botPad - tinyH) / 2;
        if (countY + tinyH <= h) {
            var nGroups = _stops.size();
            var nDirs   = getCurrentDirections().size();
            dc.setColor(0x555555, Graphics.COLOR_TRANSPARENT);
            drawPlainInBox(dc,
                "< " + (_groupIndex + 1) + "/" + nGroups
                    + "  v  " + (_directionIndex + 1) + "/" + nDirs + " >",
                safeX, safeW, countY, tinyFont, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // Draw one departure row: [MIN white]  [LINE in colour]  [headsign dimmed]
    // listTop / listHeight define the visible clip region. Each column is clipped
    // to (columnX, listTop, columnW, listHeight) so no row content can bleed
    // outside the list area even when the row is partially scrolled off screen.
    function drawDepartureRow(dc, dep, x, safeW, y, bodyFont, tinyFont, listTop, listHeight) {
        var lineStr   = dep["line"]    != null ? dep["line"].toString()    : "";
        var minStr    = dep["minutes"] != null ? dep["minutes"].toString() + "m" : "?m";
        var headsign  = dep["headsign"] != null ? dep["headsign"].toString() : "";
        var routeType = dep["routeType"];

        // Fixed-width column proportions: MIN | LINE | gap | HEADSIGN
        var minColW  = safeW * 22 / 100;
        var lineColW = safeW * 18 / 100;
        var gap      = 6;
        var headX    = x + minColW + lineColW + gap;
        var headW    = safeW - minColW - lineColW - gap;

        // Minutes — clip to its column × list height, bright white
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setClip(x, listTop, minColW, listHeight);
        dc.drawText(x + minColW, y, bodyFont, minStr, Graphics.TEXT_JUSTIFY_RIGHT);

        // Line number — clip to its column × list height, colour by route type
        dc.setColor(routeColor(routeType), Graphics.COLOR_TRANSPARENT);
        dc.setClip(x + minColW, listTop, lineColW, listHeight);
        dc.drawText(x + minColW + lineColW, y, bodyFont, lineStr, Graphics.TEXT_JUSTIFY_RIGHT);

        // Headsign — clip to its column × list height, dimmed
        dc.setColor(0xAAAAAA, Graphics.COLOR_TRANSPARENT);
        dc.setClip(headX, listTop, headW, listHeight);
        dc.drawText(headX, y, tinyFont, headsign, Graphics.TEXT_JUSTIFY_LEFT);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    }

    // Route-type colour coding (Prague PID palette)
    // 0=tram  1=metro  3=bus  11=trolleybus
    function routeColor(routeType) {
        if (routeType == 1)  { return 0x5B9BD5; } // metro  — blue
        if (routeType == 0)  { return 0xF0B700; } // tram   — amber
        if (routeType == 11) { return 0x78C8F0; } // trolleybus — light blue
        return 0xCCCCCC;                           // bus    — light grey
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function getCurrentGroup() {
        if (_stops == null || _stops.size() == 0) { return null; }
        return _stops[_groupIndex];
    }

    function getCurrentDirections() {
        var group = getCurrentGroup();
        if (group == null) { return null; }
        return group["directions"];
    }

    function getCurrentDirection() {
        var dirs = getCurrentDirections();
        if (dirs == null || dirs.size() == 0) { return null; }
        if (_directionIndex >= dirs.size()) { _directionIndex = 0; }
        return dirs[_directionIndex];
    }

    // Draw text clipped to [x, x+width], plain (no scroll).
    function drawPlainInBox(dc, text, x, width, y, font, justification) {
        var drawX = justification == Graphics.TEXT_JUSTIFY_CENTER
            ? x + width / 2
            : (justification == Graphics.TEXT_JUSTIFY_RIGHT ? x + width : x);
        dc.setClip(x, y, width, dc.getFontHeight(font) + 2);
        dc.drawText(drawX, y, font, text, justification);
        dc.setClip(0, 0, dc.getWidth(), dc.getHeight());
    }

    // Draw text clipped to [x, x+width] with horizontal ticker scrolling when
    // the text is wider than the box.  Returns true while still animating.
    function drawTickerInBox(dc, text, x, width, y, font, justification) {
        if (text == null) { text = ""; }
        var textW = dc.getTextWidthInPixels(text, font);
        if (textW <= width) {
            drawPlainInBox(dc, text, x, width, y, font, justification);
            return false;
        }
        var gap    = 20;
        var travel = textW - width + gap;
        var tick   = System.getTimer() / 100;
        var offset = tick % travel;
        dc.setClip(x, y, width, dc.getFontHeight(font) + 2);
        dc.drawText(x - offset,            y, font, text, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x - offset + textW + gap, y, font, text, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setClip(0, 0, dc.getWidth(), dc.getHeight());
        return true;
    }
}
