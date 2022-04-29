define([
	'jquery',
	'/common/toolbar.js',
	'json.sortify',
	'/bower_components/nthen/index.js',
	'/common/sframe-common.js',
	'/common/common-interface.js',
	'/common/common-hash.js',
	'/common/common-util.js',
	'/common/common-ui-elements.js',
	'/common/common-feedback.js',
	'/common/hyperscript.js',
	'/api/config',
	'/customize/messages.js',
	'/customize/application_config.js',
	'/bower_components/chainpad/chainpad.dist.js',
	'/file/file-crypto.js',
	'/common/onlyoffice/history.js',
	'/common/onlyoffice/oocell_base.js',
	'/common/onlyoffice/oodoc_base.js',
	'/common/onlyoffice/ooslide_base.js',
	'/common/outer/worker-channel.js',
	'/common/outer/x2t.js',

	'/bower_components/file-saver/FileSaver.min.js',

	'css!/bower_components/bootstrap/dist/css/bootstrap.min.css',
	'less!/bower_components/components-font-awesome/css/font-awesome.min.css',
	'less!/common/onlyoffice/app-oo.less',
], function (
	$,
	Toolbar,
	JSONSortify,
	nThen,
	SFCommon,
	UI,
	Hash,
	Util,
	UIElements,
	Feedback,
	h,
	ApiConfig,
	Messages,
	AppConfig,
	ChainPad,
	FileCrypto,
	History,
	EmptyCell,
	EmptyDoc,
	EmptySlide,
	Channel,
	X2T)
{
	var APP = window.APP = {
		$: $,
		urlArgs: Util.find(ApiConfig, ['requireConf', 'urlArgs'])
	};
	var myUniqueOOId;
	var myOOId;
	var cursor;
	var CURRENT_VERSION = X2T.CURRENT_VERSION;
	var offline = true;
	var Nacl = window.nacl;
	var evOnSync = Util.mkEvent();

	var now = function () { return +new Date(); };

	var debug = function (x, type) {
		if (!window.CP_DEV_MODE) { return; }
		console.debug(x, type);
	};

	var setEditable = function (state, force) {
		$('#cp-app-oo-editor').find('#cp-app-oo-offline').remove();
		/*
		try {
			getEditor().asc_setViewMode(!state);
			//window.frames[0].editor.setViewModeDisconnect(true);
		} catch (e) {}
		*/
		if (!state && (false || force)) {
			$('#cp-app-oo-editor').append(h('div#cp-app-oo-offline'));
		}
	};

	var main = function () {
		var common;

		var handleAuth = function(obj, send) {
			debugger
			const changes = [];
			//setEditable(false, true);
			send({
				type: "authChanges",
				changes: changes
			});

			// Answer to the auth command
			var p = {
				index: 1,
				list: []
			};

			send({
				type: "auth",
				result: 1,
				sessionId: Hash.createChannelId(),
				participants: p.list,
				locks: [],
				changes: [],
				changesIndex: 0,
				indexUser: p.index,
				buildVersion: "5.2.6",
				buildNumber: 2,
				licenseType: 3,
				//"g_cAscSpellCheckUrl": "/spellchecker",
				//"settings":{"spellcheckerUrl":"/spellchecker","reconnection":{"attempts":50,"delay":2000}}
			});
			// Open the document
			send({
				type: "documentOpen",
				data: {"type":"open","status":"ok","data":{"Editor.bin":obj.openCmd.url}}
			});
		};

		var parseChanges = function (changes, isObj) {
			try {
				changes = JSON.parse(changes);
			} catch (e) {
				return [];
			}
			return changes.map(function (change) {
				return {
					docid: "fresh",
					change: isObj ? change : '"' + change + '"',
					time: now(),
					user: myUniqueOOId,
					useridoriginal: String(myOOId)
				};
			});
		};

		var makeChannel = function () {
			var msgEv = Util.mkEvent();
			var iframe = $('#cp-app-oo-editor > iframe')[0].contentWindow;
			var type = common.getMetadataMgr().getPrivateData().ooType;
			debugger
			window.addEventListener('message', function (msg) {
				if (msg.source !== iframe) { return; }
				msgEv.fire(msg);
			});
			var postMsg = function (data) {
				iframe.postMessage(data, ApiConfig.httpSafeOrigin);
			};
			Channel.create(msgEv, postMsg, function (chan) {
				APP.chan = chan;

				var send = function (obj, force) {
					// can't push to OO before reloading cp
					if (APP.onStrictSaveChanges && !force) { return; }
					// We only need to release locks for sheets
					if (type !== "sheet" && obj.type === "releaseLock") { return; }
					if (type === "presentation" && obj.type === "cp_theme") {
						console.error(obj);

						return;
					}

					debug(obj, 'toOO');
					chan.event('CMD', obj);
				};

				chan.on('CMD', function (obj) {
					debug(obj, 'fromOO');
					switch (obj.type) {
						case "auth":
							handleAuth(obj, send);
							break;
						case "isSaveLock":
							// TODO ping the server to check if we're online first?
							if (!offline) {
								if (APP.waitLock) {
									APP.waitLock.reg(function () {
										send({
											type: "saveLock",
											saveLock: false
										}, true);
									});
								} else {
									send({
										type: "saveLock",
										saveLock: false
									}, true);
								}
							}
							break;
						case "cursor":
							if (cursor && cursor.updateCursor) {
								cursor.updateCursor({
									type: "cursor",
									messages: [{
										cursor: obj.cursor,
										time: +new Date(),
										user: 'c0c3bf82-20d7-4663-bf6d-7fa39c598b1d',
										useridoriginal: 'c0c3bf82-20d7-4663-bf6d-7fa39c598b1d'
									}]
								});
							}
							break;
						case "getLock":
							//handleLock(obj, send);
							break;
						case "getMessages":
							// OO chat messages?
							send({ type: "message" });
							break;
						case "saveChanges":
							// If we have unsaved data before reloading for a checkpoint...
							if (APP.onStrictSaveChanges) {
								delete APP.unsavedLocks;
								APP.unsavedChanges = {
									type: "saveChanges",
									changes: parseChanges(obj.changes),
									changesIndex: 0,
									locks: type === "sheet" ? [] : APP.unsavedLocks,
									excelAdditionalInfo: null,
									recover: true
								};
								APP.onStrictSaveChanges();
								return;
							}
							var AscCommon = window.frames[0] && window.frames[0].AscCommon;
							if (Util.find(AscCommon, ['CollaborativeEditing','m_bFast'])
								&& APP.themeLocked) {
								obj = APP.themeLocked;
								APP.themeLocked = undefined;
								obj.type = "cp_theme";
								console.error(obj);
							}
							break;
						case "unLockDocument":
							break;
						case 'openDocument':
							// When duplicating a slide, OO may ask the URLs of the images
							// in that slide
							var _obj = obj.message;
							if (_obj.c === "imgurls") {
								var _mediasSources = {};
								var images = _obj.data || [];
								if (!Array.isArray(images)) { return; }
								var urls = [];
								nThen(function (waitFor) {
									images.forEach(function (name) {
										if (/^data\:image/.test(name)) {
											Util.fetch(name, waitFor(function (err, u8) {
												if (err) { return; }
												var b = new Blob([u8]);
												urls.push(URL.createObjectURL(b));
											}));
											return;
										}
										var data = _mediasSources[name];
										if (!data) { return; }
										var media = null;
										if (!media) { return; }
										urls.push({
											path: name,
											url: media.blobUrl,
										});
									});
								}).nThen(function () {
									send({
										type: "documentOpen",
										data: {
											type: "imgurls",
											status: "ok",
											data: {
												urls: urls,
												error: 0
											}
										}
									});
								});
							}
							break;
					}
				});
			});
		};

		var getWindow = function () {
			return window.frames && window.frames[0];
		};
		var getEditor = function () {
			var w = getWindow();
			if (!w) { return; }
			return w.editor || w.editorCell;
		};

		var x2tConvertData = function (data, fileName, format, cb) {
			var sframeChan = common.getSframeChannel();
			var e = getEditor();
			var fonts = e && e.FontLoader.fontInfos;
			var files = e && e.FontLoader.fontFiles.map(function (f) {
				return { 'Id': f.Id, };
			});
			var type = common.getMetadataMgr().getPrivateData().ooType;
			debugger
			var images = (e && window.frames[0].AscCommon.g_oDocumentUrls.urls) || {};

			// Fix race condition which could drop images sometimes
			// ==> make sure each image has a 'media/image_name.ext' entry as well
			Object.keys(images).forEach(function (img) {
				if (/^media\//.test(img)) { return; }
				if (images['media/'+img]) { return; }
				images['media/'+img] = images[img];
			});

			// Add theme images
			var theme = e && window.frames[0].AscCommon.g_image_loader.map_image_index;
			if (theme) {
				Object.keys(theme).forEach(function (url) {
					if (!/^(\/|blob:|data:)/.test(url)) {
						images[url] = url;
					}
				});
			}

			sframeChan.query('Q_OO_CONVERT', {
				data: data,
				type: type,
				fileName: fileName,
				outputFormat: format,
				images: (e && window.frames[0].AscCommon.g_oDocumentUrls.urls) || {},
				fonts: fonts,
				fonts_files: files,
				mediasSources: {},
				mediasData: {}
			}, function (err, obj) {
				if (err || !obj || !obj.data) {
					UI.warn(Messages.error);
					return void cb();
				}
				cb(obj.data, obj.images);
			}, {
				raw: true
			});
		};

		var getFileType = function (filename) {
			var type = common.getMetadataMgr().getPrivateData().ooType;
			debugger
			var title = filename;
			// if (APP.downloadType) {
			//     type = APP.downloadType;
			//     title = "download";
			// }
			var file = {};
			switch(type) {
				case 'doc':
					file.type = 'docx';
					file.title = title + '.docx' || 'document.docx';
					file.doc = 'word';
					break;
				case 'sheet':
					file.type = 'xlsx';
					file.title = title + '.xlsx' || 'spreadsheet.xlsx';
					file.doc = 'cell';
					break;
				case 'presentation':
					file.type = 'pptx';
					file.title = title + '.pptx' || 'presentation.pptx';
					file.doc = 'slide';
					break;
			}
			return file;
		};

		var getMediasSources = APP.getMediasSources =  function() {
			return {};
		};

		var downloadImages = {};
		var mediasData = {};

		const startOO = function(blob, file) {
			var lang = (window.cryptpadLanguage || navigator.language || navigator.userLanguage || '').slice(0,2);

			var url = URL.createObjectURL(blob);

			APP.ooconfig = {
				"document": {
					"fileType": file.type,
					"key": "fresh",
					"title": file.title,
					"url": url,
					"permissions": {
						"download": false,
						"print": true,
					}
				},
				"documentType": file.doc,
				"editorConfig": {
					customization: {
						chat: false,
						logo: {
							url: "/bounce/#" + encodeURIComponent('https://www.onlyoffice.com')
						}
					},
					"user": {
						"id": "c0c3bf82-20d7-4663-bf6d-7fa39c598b1d",
						"firstname": Messages.anonymous,
						"name":Messages.anonymous,
					},
					"mode": "view",
					"lang": lang
				},
				"events": {
					"onAppReady": function(/*evt*/) {
						debugger
						var $iframe = $('iframe[name="frameEditor"]').contents();
						$iframe.prop('tabindex', '-1');
						var $tb = $iframe.find('head');
						var css = // Old OO
							//'#id-toolbar-full .toolbar-group:nth-child(2), #id-toolbar-full .separator:nth-child(3) { display: none; }' +
							//'#fm-btn-save { display: none !important; }' +
							//'#panel-settings-general tr.autosave { display: none !important; }' +
							//'#panel-settings-general tr.coauth { display: none !important; }' +
							//'#header { display: none !important; }' +
							'#title-doc-name { display: none !important; }' +
							'#title-user-name { display: none !important; }' +
							(true ? '' : '#slot-btn-dt-print { display: none !important; }') +
							// New OO:
							'section[data-tab="ins"] .separator:nth-last-child(2) { display: none !important; }' + // separator
							'#slot-btn-insequation { display: none !important; }' + // Insert equation
							//'#asc-gen125 { display: none !important; }' + // Disable presenter mode
							//'.toolbar .tabs .ribtab:not(.canedit) { display: none !important; }' + // Switch collaborative mode
							'#fm-btn-info { display: none !important; }' + // Author name, doc title, etc. in "File" (menu entry)
							'#panel-info { display: none !important; }' + // Same but content
							'#image-button-from-url { display: none !important; }' + // Inline image settings: replace with url
							'.cp-from-url, #textart-button-from-url { display: none !important; }' + // Spellcheck language
							'.statusbar .cnt-lang { display: none !important; }' + // Spellcheck language
							'.statusbar #btn-doc-spell { display: none !important; }' + // Spellcheck button
							'#file-menu-panel .devider { display: none !important; }' + // separator in the "File" menu
							'#left-btn-spellcheck, #left-btn-about { display: none !important; }'+
							'div.btn-users.dropdown-toggle { display: none; !important }' +
							'#cp-app-oo-container { display: block }';
						css += '#toolbar { display: none !important; }';
						//css += '#app-title { display: none !important; }'; // OnlyOffice logo + doc title
						//css += '#file-menu-panel { top: 28px !important; }'; // Position of the "File" menu
						$('<style>').text(css).appendTo($tb);
						setTimeout(function () {
							$(window).trigger('resize');
						});
						if (UI.findOKButton().length) {
							UI.findOKButton().on('focusout', function () {
								window.setTimeout(function () { UI.findOKButton().focus(); });
							});
						}
					},
					"onError": function (ev) {
						console.error(arguments);
						// if (APP.isDownload) {
						//     var sframeChan = common.getSframeChannel();
						//     sframeChan.event('EV_OOIFRAME_DONE', '');
						// }
					},
					"onDocumentReady": function () {
						evOnSync.fire();
						var onMigrateRdy = Util.mkEvent();
						onMigrateRdy.reg(function () {
							var div = h('div.cp-oo-x2tXls', [
								h('span.fa.fa-spin.fa-spinner'),
								h('span', Messages.oo_sheetMigration_loading)
							]);
							APP.migrateModal = UI.openCustomModal(UI.dialog.customModal(div, {buttons: []}));
						});
						// DEPRECATED: from version 3, the queue is sent again during init
						try { getEditor().asc_setRestriction(true); } catch (e) {}

						delete APP.startNew;

						$('#cp-app-oo-editor > iframe')[0].contentWindow.focus();

						APP.onLocal(); // Add our data to the userlist

						onMigrateRdy.fire();

						try { getEditor().asc_setViewMode(true); } catch (e) {}
						const elem = $('#cp-app-oo-container')

						debugger
						console.log(elem);
					}
				}
			};

			APP.docEditor = new window.DocsAPI.DocEditor("cp-app-oo-placeholder-a", APP.ooconfig);
			$('#cp-app-oo-editor > iframe')[0].contentWindow.focus();
			makeChannel();
		};

		const loadDocument = function () {
			window.parent.postMessage({ readyToAcceptFile: true }, '*');
			const callback = function(e) {
				if (e.data.externalFile && e.data.externalFileName) {
					const {externalFileName, externalFile} = e.data;
					window.removeEventListener('message', callback);

					const u8 = new Uint8Array(externalFile);

					x2tConvertData(new Uint8Array(u8), externalFileName, 'bin', (binData, images) => {
						debugger
						let localBlob = new Blob([binData], {type: 'plain/text'});

						startOO(localBlob, getFileType());
					});
				}
			};

			window.addEventListener('message', callback);
		};


		nThen(function (waitFor) {
			$(waitFor(function () {
				UI.addLoadingScreen();
			}));
			SFCommon.create(waitFor(function (c) { APP.common = common = c; }));
		}).nThen(function (waitFor) {
			var next = function () {
				loadDocument();
				//setEditable(false);
				UI.removeLoadingScreen();
			};

			APP.loadingImage = 0;

			APP.getImageURL = function(name, callback) {
				if (name && /^data:image/.test(name)) {
					return void callback('');
				}

				var mediasSources = getMediasSources();
				var data = mediasSources[name];
				downloadImages[name] = Util.mkEvent(true);

				if (typeof data === 'undefined') {
					if (/^http/.test(name) && /slide\/themes\/theme/.test(name)) {
						Util.fetch(name, function (err, u8) {
							if (err) { return; }
							mediasData[name] = {
								blobUrl: name,
								content: u8,
								name: name
							};
							var b = new Blob([u8], {type: "image/jpeg"});
							var blobUrl = URL.createObjectURL(b);
							return void callback(blobUrl);
						});
						return;
					}
					debug("CryptPad - could not find matching media for " + name);
					return void callback("");
				}

				var blobUrl = (typeof mediasData[data.src] === 'undefined') ? "" : mediasData[data.src].blobUrl;
				if (blobUrl) {
					delete downloadImages[name];
					debug("CryptPad Image already loaded " + blobUrl);
					return void callback(blobUrl);
				}

				APP.loadingImage++;
				Util.fetch(data.src, function (err, u8) {
					if (err) {
						APP.loadingImage--;
						console.error(err);
						return void callback("");
					}
					try {
						debug("Decrypt with key " + data.key);
						FileCrypto.decrypt(u8, Nacl.util.decodeBase64(data.key), function (err, res) {
							APP.loadingImage--;
							if (err || !res.content) {
								debug("Decrypting failed");
								return void callback("");
							}

							try {
								var blobUrl = URL.createObjectURL(res.content);
								// store media blobUrl and content for cache and export
								var mediaData = {
									blobUrl : blobUrl,
									content : "",
									name: name
								};
								mediasData[data.src] = mediaData;
								var reader = new FileReader();
								reader.onloadend = function () {
									debug("MediaData set");
									mediaData.content = reader.result;
									downloadImages[name].fire();
								};
								reader.readAsArrayBuffer(res.content);
								debug("Adding CryptPad Image " + data.name + ": " +  blobUrl);
								window.frames[0].AscCommon.g_oDocumentUrls.addImageUrl(data.name, blobUrl);
								callback(blobUrl);
							} catch (e) {}
						});
					} catch (e) {
						APP.loadingImage--;
						debug("Exception decrypting image " + data.name);
						console.error(e);
						callback("");
					}
				}, void 0, common.getCache());
			};

			var version = CURRENT_VERSION+'/';
			var s = h('script', {
				type:'text/javascript',
				src: '/common/onlyoffice/'+version+'web-apps/apps/api/documents/api.js'
			});
			$('#cp-app-oo-editor').empty().append(h('div#cp-app-oo-placeholder-a')).append(s);

			waitFor(next());
		});
	};
	main();
});