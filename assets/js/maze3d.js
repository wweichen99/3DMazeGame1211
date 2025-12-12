(function() {
    var width = window.innerWidth * 0.995;
    var height = window.innerHeight * 0.995;
    var canvasContainer = document.getElementById("canvasContainer");
    var renderer, camera, scene;
    var input, miniMap, levelHelper, CameraHelper;
    var map = new Array();
    var running = true;

    // --- Pointer Lock (mouse look) state ---
    var _plActive = false;
    var _mouseSensitivity = 0.002;

    // --- WASD 键状态 ---
    var _keys = { w: false, a: false, s: false, d: false };

    // --- 透视导航变量 ---
    var guideLine; 
    var exitPosition = new THREE.Vector3(); 
    var hasExit = false; 

    // === 数据采集变量 (Data Collection Variables) ===
    var viewportLogs = []; 
    var minimapLogs = { hovers: {}, clicks: {} }; 
    var gazeLogs = []; 
    var targets = {}; 
    var lastLogTime = 0;
    var LOG_INTERVAL = 250; 

    // === Minimap config & helpers ===
    var mapScale = 16; 
    function $(id){ return document.getElementById(id); }
    function isWallCellByValue(v){ return (v != 1 && !isNaN(v)); }
    
    function worldToTileFloat(wx, wz) {
        var tileSize = 100;
        var platformWidth = map[0].length * tileSize;
        var platformHeight = map.length * tileSize;
        var tx = (wx + platformWidth/2) / tileSize + 0.2;
        var ty = (wz + platformHeight/2) / tileSize + 0.4;
        return { tx: tx, ty: ty };
    }

    function initializeEngine() {
        renderer = new THREE.WebGLRenderer({
            antialias: true
        });

        renderer.setSize(width, height);
        renderer.clear();

        scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x777777, 25, 1000);

        camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        camera.position.y = 50;

        document.getElementById("canvasContainer").appendChild(renderer.domElement);

        input = new Demonixis.Input();
        levelHelper = new Demonixis.GameHelper.LevelHelper();
        cameraHelper = new Demonixis.GameHelper.CameraHelper(camera);
        cameraHelper.translation = 5; 
        cameraHelper.rotation    = 0.04;

        window.addEventListener("resize", function() {
            var w = window.innerWidth;
            var h = window.innerHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });

        window.addEventListener("keydown", function(e) {
            var k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
                _keys[k] = true;
            }
        });
        window.addEventListener("keyup", function(e) {
            var k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
                _keys[k] = false;
            }
        });

        // 简化的开始提示，避免遮挡新UI
        var messageContainer = document.createElement("div");
        messageContainer.style.position = "absolute";
        messageContainer.style.top = "50%";
        messageContainer.style.left = "50%";
        messageContainer.style.transform = "translate(-50%, -50%)";
        messageContainer.style.backgroundColor = "rgba(0,0,0,0.8)";
        messageContainer.style.padding = "20px";
        messageContainer.style.border = "1px solid #00f0ff";
        messageContainer.style.borderRadius = "10px";
        messageContainer.style.textAlign = "center";
        messageContainer.style.zIndex = "2000";

        messageContainer.innerHTML = 
            "<h2 style='color:#00f0ff; margin:0 0 10px 0'>SYSTEM READY</h2>" +
            "<p style='color:#fff'>Click to Start<br>Use WASD to Move</p>";

        document.body.appendChild(messageContainer);

        var timer = setTimeout(function() {
            if(document.body.contains(messageContainer)) {
                document.body.removeChild(messageContainer);
            }
        }, 5000);

        setupPointerLock();
        setupMinimapTracking();
    }

    // 设置小地图交互追踪
    function setupMinimapTracking() {
        var minimapCanvas = $("objects"); 
        if (!minimapCanvas) {
            setTimeout(setupMinimapTracking, 500); 
            return;
        }

        function getGridKey(e) {
            var rect = minimapCanvas.getBoundingClientRect();
            // 需要考虑Canvas的缩放比例
            var scaleX = minimapCanvas.width / rect.width;
            var scaleY = minimapCanvas.height / rect.height;
            
            var x = (e.clientX - rect.left) * scaleX;
            var y = (e.clientY - rect.top) * scaleY;
            
            var gx = Math.floor(x / mapScale);
            var gy = Math.floor(y / mapScale);
            
            if (gx >= 0 && gy >= 0 && map.length > 0 && gy < map.length && gx < map[0].length) {
                return gx + "," + gy;
            }
            return null;
        }

        minimapCanvas.addEventListener('mousemove', function(e) {
            var key = getGridKey(e);
            if (key) {
                if (!minimapLogs.hovers[key]) minimapLogs.hovers[key] = 0;
                minimapLogs.hovers[key]++;
            }
        });

        minimapCanvas.addEventListener('click', function(e) {
            var key = getGridKey(e);
            if (key) {
                if (!minimapLogs.clicks[key]) minimapLogs.clicks[key] = 0;
                minimapLogs.clicks[key]++;
            }
        });
    }

    // [MODIFIED] 初始化 WebGazer UI 并移动到 HUD
    function initWebGazer() {
        if (typeof webgazer !== 'undefined') {
            webgazer.setGazeListener(function(data, elapsedTime) {
                if (data == null) {
                    return;
                }
                gazeLogs.push({
                    timestamp: Date.now(),
                    x: Math.round(data.x),
                    y: Math.round(data.y)
                });
            }).begin();

            webgazer.showVideoPreview(true);
            
            // --- 关键修改：将 WebGazer 的元素移动到我们自定义的 HUD 容器中 ---
            var checkGazerUI = setInterval(function(){
                var video = document.getElementById('webgazerVideoFeed');
                var target = document.getElementById('webgazer-target');
                
                // 只有当视频元素生成，且目标容器存在时才执行
                if (video && target) {
                    if (video.parentElement !== target) {
                        // 清空目标容器，防止重复
                        target.innerHTML = '';
                        
                        // 移动视频元素
                        target.appendChild(video);
                        
                        // 移动 Canvas (面部网格) 和 Feedback Box (定位框)
                        var canvas = document.getElementById('webgazerVideoCanvas');
                        var faceOverlay = document.getElementById('webgazerFaceOverlay');
                        var feedbackBox = document.getElementById('webgazerFaceFeedbackBox');

                        if(canvas) target.appendChild(canvas);
                        if(faceOverlay) target.appendChild(faceOverlay);
                        if(feedbackBox) target.appendChild(feedbackBox);

                        // 强制重置样式以适应圆形容器
                        var elements = [video, canvas, faceOverlay, feedbackBox];
                        elements.forEach(function(el) {
                            if(el) {
                                el.style.position = 'absolute';
                                el.style.top = '0';
                                el.style.left = '0';
                                el.style.width = '100%';
                                el.style.height = '100%';
                                el.style.objectFit = 'cover'; // 保证画面填满圆形
                                el.style.transform = 'scaleX(-1)'; // 镜像翻转，符合镜子习惯
                            }
                        });

                        console.log("HUD: WebGazer UI integrated.");
                        clearInterval(checkGazerUI);
                    }
                }
            }, 500); 
        } else {
            console.warn("WebGazer not found.");
        }
    }

    function setupPointerLock() {
        var el = renderer.domElement;

        function onPointerLockChange() {
            var locked = (document.pointerLockElement === el) ||
                         (document.mozPointerLockElement === el) ||
                         (document.webkitPointerLockElement === el);
            _plActive = !!locked;
        }

        function onPointerLockError() {
            console.warn("PointerLock error");
            _plActive = false;
        }

        function onMouseMove(e) {
            if (!_plActive) return;
            var movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
            camera.rotation.y -= movementX * _mouseSensitivity;
        }

        el.addEventListener('click', function () {
            if (el.requestPointerLock) el.requestPointerLock();
            else if (el.mozRequestPointerLock) el.mozRequestPointerLock();
            else if (el.webkitRequestPointerLock) el.webkitRequestPointerLock();
        });

        document.addEventListener('pointerlockchange', onPointerLockChange, false);
        document.addEventListener('mozpointerlockchange', onPointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', onPointerLockChange, false);
        document.addEventListener('pointerlockerror', onPointerLockError, false);
        document.addEventListener('mousemove', onMouseMove, false);
    }

    function initializeScene() {
        hasExit = false;
        if(guideLine) { scene.remove(guideLine); guideLine = null; }
        
        viewportLogs = [];
        minimapLogs = { hovers: {}, clicks: {} };
        gazeLogs = []; 
        targets = {}; 

        var loader = new THREE.TextureLoader();
        var platformWidth = map[0].length * 100;
        var platformHeight = map.length * 100;

        var floorGeometry = new THREE.BoxGeometry(platformWidth, 5, platformHeight);
        var ground = new THREE.Mesh(floorGeometry, new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/ground_diffuse.jpg"),
        }));

        repeatTexture(ground.material.map, 2);

        ground.position.set(-50, 1, -50);
        scene.add(ground);

        var topMesh = new THREE.Mesh(floorGeometry, new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/roof_diffuse.jpg")
        }));

        repeatTexture(topMesh.material.map, 16);

        topMesh.position.set(-50, 100, -50);
        scene.add(topMesh);

        var size = { x: 100, y: 100, z: 100 };
        var position = { x: 0, y: 0, z: 0 };

        var wallGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        var wallMaterial = new THREE.MeshPhongMaterial({
            map: loader.load("assets/images/textures/wall_diffuse.jpg")
        });
        repeatTexture(wallMaterial.map, 2);

        var xrayMaterial = new THREE.MeshBasicMaterial({
            color: 0x0088ff, 
            wireframe: true,
            depthTest: false, 
            depthWrite: false,
            transparent: true,
            opacity: 0.4
        });

        for (var y = 0, ly = map.length; y < ly; y++) {
            for (var x = 0, lx = map[x].length; x < lx; x++) {
                position.x = -platformWidth / 2 + size.x * x;
                position.y = 50;
                position.z = -platformHeight / 2 + size.z * y;

                if (x == 0 && y == 0) {
                    cameraHelper.origin.x = position.x;
                    cameraHelper.origin.y = position.y;
                    cameraHelper.origin.z = position.z;
                }

                if (map[y][x] > 1) {
                    var wall3D = new THREE.Mesh(wallGeometry, wallMaterial);
                    wall3D.position.set(position.x, position.y, position.z);
                    scene.add(wall3D);

                    var xrayMesh = new THREE.Mesh(wallGeometry, xrayMaterial);
                    xrayMesh.position.set(position.x, position.y, position.z);
                    xrayMesh.scale.set(1.01, 1.01, 1.01); 
                    scene.add(xrayMesh);
                }

                if (map[y][x] === "D") {
                    camera.position.set(position.x, position.y, position.z);
                    cameraHelper.origin.position.x = position.x;
                    cameraHelper.origin.position.y = position.y;
                    cameraHelper.origin.position.z = position.z;
                    cameraHelper.origin.position.mapX = x;
                    cameraHelper.origin.position.mapY = y;
                    cameraHelper.origin.position.mapZ = 0;
                    
                    targets['Start'] = new THREE.Vector3(position.x, position.y, position.z);
                }

                if (map[y][x] === "A") {
                    exitPosition.set(position.x, position.y, position.z);
                    hasExit = true;
                    
                    var goalGeo = new THREE.BoxGeometry(20, 100, 20);
                    var goalMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false, transparent: true, opacity: 0.6 });
                    var goalMesh = new THREE.Mesh(goalGeo, goalMat);
                    goalMesh.position.set(position.x, position.y, position.z);
                    scene.add(goalMesh);

                    targets['Exit'] = new THREE.Vector3(position.x, position.y, position.z);
                }
            }
        }

        if (hasExit) {
            var lineGeo = new THREE.Geometry();
            lineGeo.vertices.push(new THREE.Vector3(camera.position.x, camera.position.y - 10, camera.position.z));
            lineGeo.vertices.push(exitPosition);

            var lineMat = new THREE.LineBasicMaterial({
                color: 0xff0000,
                linewidth: 2,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.8
            });

            guideLine = new THREE.Line(lineGeo, lineMat);
            scene.add(guideLine);
        }

        var directionalLight = new THREE.HemisphereLight(0x192F3F, 0x28343A, 2);
        directionalLight.position.set(1, 1, 0);
        scene.add(directionalLight);

        drawMiniMapStatic();
    }

    function drawMiniMapStatic() {
        var mm = $("minimap");
        var obj = $("objects");
        if (!mm || !obj) return;
        var w = map[0].length * mapScale;
        var h = map.length * mapScale;
        mm.width = obj.width = w;
        mm.height = obj.height = h;
        var ctx = mm.getContext("2d");
        ctx.clearRect(0,0,w,h);
        for (var y=0; y<map.length; y++) {
            for (var x=0; x<map[0].length; x++) {
                var v = map[y][x];
                ctx.fillStyle = isWallCellByValue(v) ? "#333" : "#eee";
                ctx.fillRect(x*mapScale, y*mapScale, mapScale, mapScale);
            }
        }
    }

    function castRay2D(tx, ty, angle, maxDist) {
        var step = 0.05; 
        var dx = Math.cos(angle) * step;
        var dy = Math.sin(angle) * step;
        var dist = 0;
        var x = tx, y = ty;
        while (dist < maxDist) {
            var cx = Math.floor(x), cy = Math.floor(y);
            if (cy < 0 || cy >= map.length || cx < 0 || cx >= map[0].length) break;
            if (isWallCellByValue(map[cy][cx])) break;
            x += dx; y += dy; dist += step;
        }
        return { x: x, y: y };
    }

    function updateMiniMapOverlay() {
        var mm = $("minimap");
        var obj = $("objects");
        if (!mm || !obj) return;

        var ctx = obj.getContext("2d");
        ctx.clearRect(0, 0, obj.width, obj.height);

        var p = worldToTileFloat(camera.position.x, camera.position.z);
        var px = p.tx, py = p.ty;

        ctx.fillStyle = "#00f0ff"; // 改为青色以匹配 HUD
        ctx.fillRect(px*mapScale - 2, py*mapScale - 2, 4, 4);

        var fov = 80 * Math.PI / 180;
        var rays = 50;
        var half = fov / 2;
        var base = -camera.rotation.y + Math.PI/2 + Math.PI; 

        ctx.strokeStyle = "rgba(0, 240, 255, 0.4)"; // 改为青色射线
        ctx.lineWidth = 0.5;
        var maxD = Math.max(map.length, map[0].length);

        for (var i=0; i<=rays; i++) {
            var t = i / rays;
            var a = base - half + t * fov;
            var hit = castRay2D(px, py, a, maxD);
            ctx.beginPath();
            ctx.moveTo(px*mapScale, py*mapScale);
            ctx.lineTo(hit.x*mapScale, hit.y*mapScale);
            ctx.stroke();
        }
    }

    function update() {
        if (input.keys.up) moveCamera("up");
        else if (input.keys.down) moveCamera("down");
        if (input.keys.left) moveCamera("left");
        else if (input.keys.right) moveCamera("right");

        if (_keys.w) moveCamera("up");
        else if (_keys.s) moveCamera("down");
        if (_keys.a) moveCamera("left");
        else if (_keys.d) moveCamera("right");

        var params = { rotation: 0.05, translation: 5 };
        if (input.joykeys.up) moveCamera("up", params);
        else if (input.joykeys.down) moveCamera("down", params);
        if (input.joykeys.left) moveCamera("left", params);
        else if (input.joykeys.right) moveCamera("right", params);

        updateMiniMapOverlay();

        if (guideLine && hasExit) {
            guideLine.geometry.vertices[0].copy(camera.position);
            guideLine.geometry.vertices[0].y -= 15; 
            guideLine.geometry.verticesNeedUpdate = true;
        }

        var now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL) {
            var camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            
            var entry = {
                timestamp: now,
                cameraPos: { x: camera.position.x.toFixed(2), y: camera.position.y.toFixed(2), z: camera.position.z.toFixed(2) },
                targetAngles: {}
            };
            
            for (var tName in targets) {
                var tPos = targets[tName];
                var toTarget = new THREE.Vector3().subVectors(tPos, camera.position).normalize();
                var angle = camDir.angleTo(toTarget) * (180 / Math.PI);
                entry.targetAngles[tName] = angle.toFixed(2);
            }
            
            viewportLogs.push(entry);
            lastLogTime = now;
        }
    }

    function draw() {
        renderer.render(scene, camera);
    }

    function moveCamera(direction, delta) {
        var collides = false;
        var position = { x: camera.position.x, z: camera.position.z };
        var rotation = camera.rotation.y;
        var offset = 75;

        var moveParamaters = {
            translation: (typeof delta != "undefined") ? delta.translation : cameraHelper.translation,
            rotation: (typeof delta != "undefined") ? delta.rotation : cameraHelper.rotation
        };

        switch (direction) {
            case "up":
                position.x -= Math.sin(-camera.rotation.y) * -moveParamaters.translation;
                position.z -= Math.cos(-camera.rotation.y) * moveParamaters.translation;
                break;
            case "down":
                position.x -= Math.sin(camera.rotation.y) * -moveParamaters.translation;
                position.z += Math.cos(camera.rotation.y) * moveParamaters.translation;
                break;
            case "left":
                rotation += moveParamaters.rotation;
                break;
            case "right":
                rotation -= moveParamaters.rotation;
                break;
        }

        var tx = Math.abs(Math.floor(((cameraHelper.origin.x + (camera.position.x * -1)) / 100)));
        var ty = Math.abs(Math.floor(((cameraHelper.origin.z + (camera.position.z * -1)) / 100)));

        var newTx = Math.abs(Math.floor(((cameraHelper.origin.x + (position.x * -1) + (offset)) / 100)));
        var newTy = Math.abs(Math.floor(((cameraHelper.origin.z + (position.z * -1) + (offset)) / 100)));

        if (newTx >= map[0].length) newTx = map[0].length;
        if (newTx < 0) newTx = 0;
        if (newTy >= map.length) newTy = map.length;
        if (newTy < 0) newTy = 0;

        if (map[newTy][newTx] != 1 && !isNaN(map[newTy][newTx])) {
            collides = true;
        } else if (map[newTy][newTx] == "A") {
            running = false;
        }

        if (collides == false) {
            camera.rotation.y = rotation;
            camera.position.x = position.x;
            camera.position.z = position.z;
        } else {
            var s = document.getElementById("bumpSound");
            if (s) s.play();
        }
    }

    function mainLoop(time) {
        if (running) {
            update();
            draw();
            window.requestAnimationFrame(mainLoop, renderer.domElement);
        } else {
            endScreen();
        }
    }

    function endScreen() {
        if (levelHelper.isFinished || levelHelper.isMobile) {
            alert("Good job, The game is over\n\nDon't forget to export your data!");
        } else {
            for (var i = 0, l = scene.children.length; i < l; i++) {
                scene.remove(scene.children[i]);
            }
            renderer.clear();
            scene = new THREE.Scene();
            loadLevel(levelHelper.getNext());
            running = true;
        }
    }

    function loadLevel(level) {
        var ajax = new XMLHttpRequest();
        ajax.open("GET", "assets/maps/maze3d-" + level + ".json", true);
        ajax.onreadystatechange = function() {
            if (ajax.readyState == 4) {
                map = JSON.parse(ajax.responseText);
                launch();
            }
        }
        ajax.send(null);
    }

    function repeatTexture(texture, size) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.x = size;
        texture.repeat.y = size;
        return texture;
    }

    function launch() {
        initializeScene();
        mainLoop();
    }

    window.onload = function() {
        initializeEngine();
        initWebGazer(); 

        var level = 1; 
        if (level > 0 || level <= levelHelper.count) {
            levelHelper.current = level;
            levelHelper.next = level + 1;
            loadLevel(level);
        } else {
            levelHelper.current = 1;
            levelHelper.next = 2;
            loadLevel(1);
        }
    };

    window.downloadMazeData = function() {
        var combinedData = {
            sessionInfo: {
                startTime: viewportLogs.length > 0 ? viewportLogs[0].timestamp : Date.now(),
                endTime: Date.now(),
                totalLogEntries: viewportLogs.length
            },
            mapInfo: {
                width: map[0].length,
                height: map.length
            },
            minimapHeatmap: minimapLogs,
            viewportDwellTime: viewportLogs,
            eyeTracking: gazeLogs 
        };

        var blob = new Blob([JSON.stringify(combinedData, null, 2)], {type : 'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'maze_user_data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

})();