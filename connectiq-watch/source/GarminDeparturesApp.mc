using Toybox.Application;
using Toybox.WatchUi;

class GarminDeparturesApp extends Application.AppBase {
    private var _view;
    private var _delegate;

    function initialize() {
        AppBase.initialize();
        _view = new GarminDeparturesView();
        _delegate = new GarminDeparturesDelegate(_view);
    }

    function getInitialView() {
        return [_view, _delegate];
    }
}
