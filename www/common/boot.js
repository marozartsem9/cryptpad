// Stage 0, this gets cached which means we can't change it. boot2.js is changable.
define(['/api/config?cb=' + (+new Date()).toString(16)], function (Config) {
    const callback = (e) => {
        if (e.data.readyToAcceptFile) {
            window.removeEventListener('message', callback);

            window.parent.postMessage( e.data, '*');

            const innerCallback = function(e) {
                if (e.data.externalFile && e.data.externalFileName) {
                    window.removeEventListener('message', innerCallback);

                    const iframe = document.getElementById('sbox-iframe').contentWindow;

                    if(iframe) {
                        iframe.postMessage({
                            externalFile: e.data.externalFile,
                            externalFileName: e.data.externalFileName
                        }, Config.httpSafeOrigin || window.location.origin);
                    }
                }
            };

            window.addEventListener('message', innerCallback);
        }
    };

    window.addEventListener('message', callback);

    if (Config.requireConf) { require.config(Config.requireConf); }
    require(['/common/boot2.js']);
});
