using Toybox.WatchUi;
using Toybox.System;

class GarminDeparturesMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _view;

    function initialize(view) {
        Menu2InputDelegate.initialize();
        _view = view;
    }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        var id = item.getId();
        if (id == :refresh) {
            _view.refresh();
        } else if (id == :exit) {
            System.exit();
        }
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
