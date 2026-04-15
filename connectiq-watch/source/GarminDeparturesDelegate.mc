using Toybox.WatchUi;
using Toybox.System;

class GarminDeparturesDelegate extends WatchUi.BehaviorDelegate {
    private var _view;
    private var _dragStartY;
    private var _scrollAtDragStart;
    private var _didDragVertically;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
        _dragStartY = 0;
        _scrollAtDragStart = 0;
        _didDragVertically = false;
    }

    function onSelect() {
        var handled = _view.handleTap();
        if (handled) { _view.resetScreenTimer(); }
        return handled;
    }

    function onMenu() {
        _view.resetScreenTimer();
        var menu = new WatchUi.Menu2({ :title => "Menu" });
        menu.addItem(new WatchUi.IconMenuItem(
            "Obnovit",
            null,
            :refresh,
            WatchUi.loadResource(Rez.Drawables.MenuRefresh),
            {}
        ));
        menu.addItem(new WatchUi.MenuItem("Konec", null, :exit, {}));
        WatchUi.pushView(menu, new GarminDeparturesMenuDelegate(_view), WatchUi.SLIDE_UP);
        return true;
    }

    // Bottom button / system back: exit the app.
    function onBack() {
        return false;
    }

    // Button-based devices: page up/down scroll, mode cycles nearby stops.
    function onNextPage() {
        var handled = _view.scrollDown();
        if (handled) { _view.resetScreenTimer(); }
        return handled;
    }

    function onPreviousPage() {
        var handled = _view.scrollUp();
        if (handled) { _view.resetScreenTimer(); }
        return handled;
    }

    function onNextMode() {
        var handled = _view.showNextStop();
        if (handled) { _view.resetScreenTimer(); }
        return handled;
    }

    function onPreviousMode() {
        var handled = _view.showPreviousStop();
        if (handled) { _view.resetScreenTimer(); }
        return handled;
    }

    // Live touch-drag: tracks finger position and scrolls the list in real time.
    // DRAG_TYPE_START captures the anchor; DRAG_TYPE_CONTINUE moves the list;
    // DRAG_TYPE_STOP finalises.  _didDragVertically suppresses a follow-on
    // SWIPE_UP/DOWN so the list does not jump again after a drag.
    function onDrag(evt) {
        var type   = evt.getType();
        var coords = evt.getCoordinates();
        var y      = coords[1];

        if (type == WatchUi.DRAG_TYPE_START) {
            _dragStartY        = y;
            _scrollAtDragStart = _view.getScrollOffset();
            _didDragVertically = false;
        } else if (type == WatchUi.DRAG_TYPE_CONTINUE) {
            var delta = _dragStartY - y;   // positive = finger moved up = scroll down
            if (delta < 0) { delta = -delta; }   // abs, restore sign below
            delta = _dragStartY - y;
            _view.setScrollOffset(_scrollAtDragStart + delta);
            if ((_dragStartY - y) * (_dragStartY - y) > 25) {
                _didDragVertically = true;
            }
            _view.resetScreenTimer();
        } else if (type == WatchUi.DRAG_TYPE_STOP) {
            // leave _didDragVertically set so the trailing SWIPE is suppressed
        }
        return true;
    }

    // Touch swipe events: left/right switch stops; up/down fall back to
    // step-scroll (only fires on fast flicks that bypassed onDrag).
    function onSwipe(evt) {
        var direction = evt.getDirection();
        var handled   = false;

        // Consume (and reset) the drag flag on any swipe
        var wasDragging = _didDragVertically;
        _didDragVertically = false;

        if (direction == WatchUi.SWIPE_LEFT) {
            handled = _view.showNextStop();
        } else if (direction == WatchUi.SWIPE_RIGHT) {
            handled = _view.showPreviousStop();
        } else if (!wasDragging && direction == WatchUi.SWIPE_DOWN) {
            handled = _view.scrollDown();
        } else if (!wasDragging && direction == WatchUi.SWIPE_UP) {
            handled = _view.scrollUp();
        }

        if (handled) { _view.resetScreenTimer(); }
        // If we were dragging, consume the swipe even if nothing else handled it
        return handled || wasDragging;
    }
}
