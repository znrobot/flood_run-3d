// ===================================================================
//  逃离洪水 3D —— 微信小程序版 (Three.js + WebGL Canvas)
// ===================================================================

// ---- polyfill ----
require('../../lib/polyfill');

// ---- Three.js ----
const THREE = require('three');

// ---- 系统信息 ----
const sysInfo = wx.getSystemInfoSync();
const W = sysInfo.windowWidth;
const H = sysInfo.windowHeight;
const DPR = Math.min(sysInfo.pixelRatio || 2, 2);

// ===================================================================
//  PAGE DATA (WXML 绑定)
// ===================================================================
Page({
  data: {
    state: 0,           // 0=menu, 1=playing, 2=win, 3=lose
    levels: [],
    selLvl: null,
    unlocked: 1,
    charKey: 'normal',
    nightMode: true,
    rulesShow: false,
    autoClimb: false,

    hudTime: '0.0',
    hudFloor: '',
    hudWater: '--',
    drownVisible: false,
    drownPct: 0,
    drownColor: '',

    winTitleText: '',
    winMsg: '',
    canNext: false,
    loseTitleText: '',
    loseMsg: '',
  },

  // =================================================================
  //  LIFECYCLE
  // =================================================================
  onLoad() {
    this._loadProgress();
    this._buildLevelData();
    this._initThreeJS();
  },

  onUnload() {
    this._stopLoop();
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
  },

  // =================================================================
  //  THREE.JS 初始化
  // =================================================================
  _initThreeJS() {
    const that = this;
    const query = wx.createSelectorQuery();
    query.select('#gameCanvas').node();
    query.exec(res => {
      const canvas = res[0].node;
      canvas.width = W * DPR;
      canvas.height = H * DPR;

      // 适配 Three.js 需要的属性
      canvas.style = canvas.style || {};
      canvas.addEventListener = canvas.addEventListener || function(){};
      canvas.removeEventListener = canvas.removeEventListener || function(){};
      canvas.clientWidth = W;
      canvas.clientHeight = H;
      canvas.dataset = {};

      // WebGL 上下文
      const gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance'
      });

      // Three.js 渲染器
      that.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        context: gl,
        antialias: true,
        alpha: false
      });
      that.renderer.shadowMap.enabled = true;
      that.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      that.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      that.renderer.toneMappingExposure = 0.9;
      that.renderer.setSize(W, H);
      that.renderer.setPixelRatio(DPR);

      // 场景
      that.scene = new THREE.Scene();
      that.scene.background = new THREE.Color(0x0d1b2a);
      that.scene.fog = new THREE.Fog(0x0d1b2a, 30, 80);

      // 相机
      that.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 200);

      // 灯光
      that.ambient = new THREE.AmbientLight(0x506080, 0.8);
      that.scene.add(that.ambient);
      that.hemi = new THREE.HemisphereLight(0x2a3a5a, 0x3e2723, 0.6);
      that.scene.add(that.hemi);
      that.keyLight = new THREE.DirectionalLight(0xffeedd, 1.6);
      that.keyLight.position.set(8, 15, 5);
      that.keyLight.castShadow = true;
      that.keyLight.shadow.mapSize.width = 1024;
      that.keyLight.shadow.mapSize.height = 1024;
      that.keyLight.shadow.camera.near = 0.5;
      that.keyLight.shadow.camera.far = 60;
      that.keyLight.shadow.camera.left = -15;
      that.keyLight.shadow.camera.right = 15;
      that.keyLight.shadow.camera.top = 15;
      that.keyLight.shadow.camera.bottom = -15;
      that.scene.add(that.keyLight);
      that.rimLight = new THREE.DirectionalLight(0x88ccff, 0.4);
      that.rimLight.position.set(-5, 8, -10);
      that.scene.add(that.rimLight);

      // 容器
      that.buildingGroup = new THREE.Group();
      that.scene.add(that.buildingGroup);
      that.waterGroup = new THREE.Group();
      that.scene.add(that.waterGroup);

      // 全局变量
      that._canvas = canvas;
      that._lastTime = Date.now();
      that._loopId = null;
      that._gameElapsed = 0;
      that._playerFloor = 0;
      that._playerOffX = 0;
      that._waterLevel = 0;
      that._drownTime = 0;
      that._cpuFloor = 0;
      that._cpuOffX = 0;
      that._cpuDrownTime = 0;
      that._cpuAlive = true;
      that._cpuDeathTime = 0;
      that._cpuLookTimer = 0;
      that._cpuCharKey = 'normal';
      that._shakeAmount = 0;
      that._cameraY = 0;
      that._mouseX = W * 0.48;
      that._mouseY = H * 0.3;
      that._mouseOnScreen = false;

      that._createGround();
      that._createStars();
      that._createWater();
      that._applyDayNight();
      that._createParticleSystem();
      that._createCursorDot();

      // 相机初始位置
      that.camera.position.set(10, 5, 12);
      that.camera.lookAt(0, 2, 0);

      // 开始渲染循环
      that._loop();
    });
  },

  // =================================================================
  //  DAY / NIGHT 模式
  // =================================================================
  _applyDayNight() {
    const s = this.scene;
    if (this.data.nightMode) {
      s.background = new THREE.Color(0x0d1b2a);
      s.fog = new THREE.Fog(0x0d1b2a, 30, 80);
      this.ambient.color.set(0x506080); this.ambient.intensity = 0.8;
      this.hemi.color.set(0x2a3a5a); this.hemi.groundColor.set(0x3e2723); this.hemi.intensity = 0.6;
      this.keyLight.color.set(0xffeedd); this.keyLight.intensity = 1.6;
      this.rimLight.intensity = 0.4;
      this.renderer.toneMappingExposure = 0.9;
      if (this._stars) this._stars.visible = true;
    } else {
      s.background = new THREE.Color(0x87ceeb);
      s.fog = new THREE.Fog(0xccccdd, 50, 140);
      this.ambient.color.set(0x8899aa); this.ambient.intensity = 1.4;
      this.hemi.color.set(0x8899cc); this.hemi.groundColor.set(0x6d8a4e); this.hemi.intensity = 1.0;
      this.keyLight.color.set(0xffffff); this.keyLight.intensity = 2.4;
      this.rimLight.intensity = 0.5;
      this.renderer.toneMappingExposure = 1.2;
      if (this._stars) this._stars.visible = false;
    }
  },

  // =================================================================
  //  3D 辅助方法
  // =================================================================
  _makeTextSprite(text, fontSize, color) {
    const c = wx.createOffscreenCanvas({ type: '2d', width: 256, height: 128 });
    const ctx = c.getContext('2d');
    ctx.fillStyle = color || '#ffffff';
    ctx.font = `bold ${fontSize || 48}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.6, 1);
    return sprite;
  },

  _buildingW() { return 3.5; },
  _buildingD() { return 1.4; },
  _floorH3D() { return 0.65; },
  _effFloors() { return this._curLevel ? this._curLevel.floors : 20; },
  _buildingH() { return this._effFloors() * this._floorH3D(); },

  // =================================================================
  //  GROUND / STARS
  // =================================================================
  _createGround() {
    if (this._ground) { this.scene.remove(this._ground); this._ground.geometry.dispose(); this._ground.material.dispose(); }
    const geo = new THREE.PlaneGeometry(40, 40);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 1, metalness: 0 });
    this._ground = new THREE.Mesh(geo, mat);
    this._ground.rotation.x = -Math.PI / 2;
    this._ground.position.y = -0.15;
    this._ground.receiveShadow = true;
    this.scene.add(this._ground);
  },

  _createStars() {
    if (this._stars) { this.scene.remove(this._stars); this._stars.geometry.dispose(); this._stars.material.dispose(); }
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random()-0.5)*50;
      pos[i*3+1] = Math.random()*30+1;
      pos[i*3+2] = (Math.random()-0.5)*30-8;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7 });
    this._stars = new THREE.Points(geo, mat);
    this.scene.add(this._stars);
  },

  // =================================================================
  //  WATER
  // =================================================================
  _createWater() {
    if (this._waterMesh) { this.waterGroup.remove(this._waterMesh); this._waterMesh.geometry.dispose(); this._waterMesh.material.dispose(); }
    if (this._waterFoam) { this.waterGroup.remove(this._waterFoam); this._waterFoam.geometry.dispose(); this._waterFoam.material.dispose(); }

    const geo = new THREE.PlaneGeometry(25, 25, 48, 48);
    geo.rotateX(-Math.PI/2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1565c0, transparent: true, opacity: 0.75,
      roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false
    });
    this._waterMesh = new THREE.Mesh(geo, mat);
    this._waterMesh.position.y = 0;
    this._waterMesh.renderOrder = 1;
    this._waterMesh.visible = false;
    this.waterGroup.add(this._waterMesh);

    const fgeo = new THREE.PlaneGeometry(26, 26, 40, 40);
    fgeo.rotateX(-Math.PI/2);
    const fmat = new THREE.MeshBasicMaterial({ color: 0x90caf9, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
    this._waterFoam = new THREE.Mesh(fgeo, fmat);
    this._waterFoam.position.y = 0.04;
    this._waterFoam.visible = false;
    this._waterFoam.renderOrder = 2;
    this.waterGroup.add(this._waterFoam);
  },

  _updateWaterVisuals() {
    const wm = this._waterMesh;
    if (!wm) return;
    const wy = this._waterLevel * this._floorH3D();
    if (this._gameElapsed < 10) { wm.visible = false; if (this._waterFoam) this._waterFoam.visible = false; return; }
    wm.visible = true;
    if (this._waterFoam) this._waterFoam.visible = true;
    wm.position.y = wy;
    if (this._waterFoam) this._waterFoam.position.y = wy + 0.04;
    const arr = wm.geometry.attributes.position.array;
    const t = this._gameElapsed;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], z = arr[i+2];
      arr[i+1] = Math.sin(x*0.6+t*2.5)*0.06 + Math.sin(z*0.8+t*1.8)*0.05
               + Math.sin((x+z)*0.4+t*3.2)*0.04 + Math.sin(x*1.2-t*2.0)*0.03;
    }
    wm.geometry.attributes.position.needsUpdate = true;
    wm.geometry.computeVertexNormals();
  },

  // =================================================================
  //  PARTICLES
  // =================================================================
  _createParticleSystem() {
    const MAX = 300;
    if (this._ps) { this.scene.remove(this._ps); this._ps.geometry.dispose(); this._ps.material.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX*3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX*3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true,
      opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this._ps = new THREE.Points(geo, mat);
    this.scene.add(this._ps);
    this._pool = [];
    for (let i = 0; i < MAX; i++) this._pool.push({ life:0, maxLife:0, x:0, y:0, z:0, vx:0, vy:0, vz:0, color:'#fff' });
    this._pActive = 0;
  },

  _spawnParticles(wx, wy, wz, count, color, spread) {
    const MAX = 300;
    for (let i = 0; i < count; i++) {
      if (this._pActive >= MAX) return;
      const p = this._pool[this._pActive];
      p.x = wx; p.y = wy; p.z = wz;
      p.vx = (Math.random()-0.5)*spread;
      p.vy = Math.random()*spread*1.5;
      p.vz = (Math.random()-0.5)*spread;
      p.life = 0.4+Math.random()*0.6;
      p.maxLife = p.life;
      p.color = color;
      this._pActive++;
    }
  },

  _updateParticles(dt) {
    if (!this._ps) return;
    const arr = this._ps.geometry.attributes.position.array;
    const carr = this._ps.geometry.attributes.color.array;
    let wi = 0;
    for (let i = 0; i < this._pActive; i++) {
      const p = this._pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._pool[i] = this._pool[this._pActive-1];
        this._pool[this._pActive-1] = p;
        this._pActive--; i--; continue;
      }
      p.x += p.vx*dt; p.y += p.vy*dt; p.z += p.vz*dt;
      arr[wi*3]=p.x; arr[wi*3+1]=p.y; arr[wi*3+2]=p.z;
      const h = p.color.replace('#','');
      carr[wi*3]=parseInt(h.substring(0,2),16)/255;
      carr[wi*3+1]=parseInt(h.substring(2,4),16)/255;
      carr[wi*3+2]=parseInt(h.substring(4,6),16)/255;
      wi++;
    }
    for (let i = wi; i < 300; i++) { arr[i*3]=0; arr[i*3+1]=-999; arr[i*3+2]=0; }
    this._ps.geometry.attributes.position.needsUpdate = true;
    this._ps.geometry.attributes.color.needsUpdate = true;
    this._ps.geometry.setDrawRange(0, wi);
  },

  // =================================================================
  //  CURSOR DOT
  // =================================================================
  _createCursorDot() {
    if (this._cursor) { this.scene.remove(this._cursor); this._cursor.geometry.dispose(); this._cursor.material.dispose(); }
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false });
    this._cursor = new THREE.Mesh(geo, mat);
    this._cursor.renderOrder = 999;
    this._cursor.visible = false;
    this.scene.add(this._cursor);

    if (this._cursorPlane) { this.scene.remove(this._cursorPlane); this._cursorPlane.geometry.dispose(); this._cursorPlane.material.dispose(); }
    this._cursorPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 40),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    this._cursorPlane.position.set(0, 6, this._buildingD()/2+0.2);
    this._cursorPlane.name = 'cp';
    this.scene.add(this._cursorPlane);
  },

  // =================================================================
  //  BUILDING
  // =================================================================
  _buildBuilding() {
    const g = this.buildingGroup;
    while (g.children.length > 0) {
      const c = g.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (Array.isArray(c.material)) c.material.forEach(m=>m.dispose()); else c.material.dispose(); }
      g.remove(c);
    }

    const bw = this._buildingW(), bd = this._buildingD(), fh = this._floorH3D();
    const maxF = this._effFloors(), bH = maxF * fh;

    // 主体
    const bodyGeo = new THREE.BoxGeometry(bw, bH, bd);
    const mats = [
      new THREE.MeshStandardMaterial({ color:0x455a64, roughness:0.75, metalness:0.2 }),
      new THREE.MeshStandardMaterial({ color:0x37474f, roughness:0.85, metalness:0.2 }),
      new THREE.MeshStandardMaterial({ color:0x37474f, roughness:0.8, metalness:0.2 }),
      new THREE.MeshStandardMaterial({ color:0x263238, roughness:0.9, metalness:0.1 }),
      new THREE.MeshStandardMaterial({ color:0x607d8b, roughness:0.7, metalness:0.2 }),
      new THREE.MeshStandardMaterial({ color:0x455a64, roughness:0.85, metalness:0.2 }),
    ];
    const body = new THREE.Mesh(bodyGeo, mats);
    body.position.set(0, bH/2, 0);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // 楼层线
    const step = maxF > 100 ? 5 : 1;
    for (let f = 0; f <= maxF; f += step) {
      const y = f * fh;
      const pts = [
        new THREE.Vector3(-bw/2,y,-bd/2), new THREE.Vector3(bw/2,y,-bd/2),
        new THREE.Vector3(bw/2,y,bd/2), new THREE.Vector3(-bw/2,y,bd/2), new THREE.Vector3(-bw/2,y,-bd/2)
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color:0x263238, transparent:true, opacity:0.4 })
      );
      g.add(line);
    }

    // 楼梯 (每层)
    for (let f = 0; f < maxF; f++) this._buildStair(f);

    // 楼层标注
    for (let f = 0; f <= maxF; f += 5) {
      const s = this._makeTextSprite(f+'F', 40, 'rgba(255,255,255,0.55)');
      s.position.set(-bw/2-0.7, f*fh+fh*0.5, bd/2);
      s.scale.set(1, 0.5, 1);
      g.add(s);
    }

    // 屋顶
    const roofGeo = new THREE.BoxGeometry(bw+0.4, 0.2, bd+0.4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color:0x37474f, roughness:0.8 }));
    roof.position.set(0, bH+0.1, 0);
    roof.castShadow = true;
    g.add(roof);
  },

  _buildStair(f) {
    const bw = this._buildingW(), bd = this._buildingD(), fh = this._floorH3D();
    const x0 = -bw/2+0.1, x1 = bw/2-0.1;
    const goRight = (f%2===0);
    const xStart = goRight ? x0 : x1, xEnd = goRight ? x1 : x0;
    const steps = 5, zFace = bd/2+0.04;
    const stepMat = new THREE.MeshStandardMaterial({ color:0xb0bec5, roughness:0.55, metalness:0.4 });

    for (let s = 0; s < steps; s++) {
      const t = s/steps, tN = (s+1)/steps;
      const sx = xStart+(xEnd-xStart)*t, ex = xStart+(xEnd-xStart)*tN;
      const mx = (sx+ex)/2, stepW = Math.abs(ex-sx)*0.85;
      const yPos = f*fh + (t+tN)/2*fh;
      const stepD = 0.12, stepH = fh/steps*0.55;
      const stepGeo = new THREE.BoxGeometry(stepW, stepH, stepD);
      const step = new THREE.Mesh(stepGeo, stepMat);
      step.position.set(mx, yPos, zFace+stepD/2);
      step.castShadow = true;
      this.buildingGroup.add(step);
      const riserGeo = new THREE.BoxGeometry(Math.abs(ex-sx), stepH*0.4, stepD*0.5);
      const riser = new THREE.Mesh(riserGeo, stepMat);
      riser.position.set(ex, yPos+stepH*0.6, zFace+stepD/2);
      this.buildingGroup.add(riser);
    }
  },

  // =================================================================
  //  PLAYER 3D 模型
  // =================================================================
  _createPlayer(isCPU) {
    const g = new THREE.Group();
    const fh = this._floorH3D();
    const bodyCol = isCPU ? 0xff8c42 : (this.CHAR_COLORS[this.data.charKey] || 0x81c784);

    const bodyGeo = new THREE.CylinderGeometry(0.12*fh, 0.17*fh, 0.24*fh, 8);
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color:bodyCol, roughness:0.6, emissive:bodyCol, emissiveIntensity:0.3 }));
    body.position.y = 0.12*fh; body.castShadow = true; body.name = 'body';
    g.add(body);

    const headGeo = new THREE.SphereGeometry(0.11*fh, 12, 12);
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color:0xffe0bd, roughness:0.5 }));
    head.position.y = 0.30*fh; head.castShadow = true; head.name = 'head';
    g.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.022*fh, 6, 6);
    const eyeMat = new THREE.MeshStandardMaterial({ color:0x111111 });
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.04*fh, 0.32*fh, 0.10*fh); g.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.04*fh, 0.32*fh, 0.10*fh); g.add(eR);

    const armGeo = new THREE.CylinderGeometry(0.025*fh, 0.03*fh, 0.16*fh, 6);
    const armMat = new THREE.MeshStandardMaterial({ color:0xffe0bd, roughness:0.5 });
    const aL = new THREE.Mesh(armGeo, armMat); aL.position.set(-0.14*fh, 0.19*fh, 0); aL.rotation.z = 0.25; g.add(aL);
    const aR = new THREE.Mesh(armGeo, armMat); aR.position.set(0.14*fh, 0.19*fh, 0); aR.rotation.z = -0.25; g.add(aR);

    const legGeo = new THREE.CylinderGeometry(0.03*fh, 0.035*fh, 0.15*fh, 6);
    const legMat = new THREE.MeshStandardMaterial({ color:0x37474f, roughness:0.7 });
    const lL = new THREE.Mesh(legGeo, legMat); lL.position.set(-0.05*fh, 0.04*fh, 0); g.add(lL);
    const lR = new THREE.Mesh(legGeo, legMat); lR.position.set(0.05*fh, 0.04*fh, 0); g.add(lR);

    const ringGeo = new THREE.TorusGeometry(0.22*fh, 0.03*fh, 8, 16);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color:isCPU?0xff8c42:0x00ff88, transparent:true, opacity:0.8 }));
    ring.rotation.x = Math.PI/2; ring.name = 'ring';
    g.add(ring);

    const icon = isCPU ? '🤖' : ({athlete:'🏃',normal:'🚶',elder:'🧑‍🦯'}[this.data.charKey]||'🚶');
    const sprite = this._makeTextSprite(icon, 48, '#ffffff');
    sprite.position.y = 0.50*fh; sprite.name = 'icon';
    g.add(sprite);

    if (isCPU) {
      const lbl = this._makeTextSprite('CPU', 28, '#ff8c42');
      lbl.position.y = 0.65*fh; lbl.scale.set(0.4, 0.2, 1);
      g.add(lbl);
    }
    return g;
  },

  _getPlayerPos(floor, offX, isCPU) {
    const bw = this._buildingW(), bd = this._buildingD(), fh = this._floorH3D();
    const y = floor * fh + fh * 0.35;
    const x0 = -bw/2+0.1, x1 = bw/2-0.1;
    const fi = Math.floor(floor), frac = floor - fi;
    const goRight = (fi%2===0);
    const sx = (goRight?x0:x1) + ((goRight?x1:x0)-(goRight?x0:x1))*frac;
    const maxLean = bw*0.35;
    const clampedOff = Math.max(-maxLean, Math.min(maxLean, offX*(bw/3.5)));
    return new THREE.Vector3(sx+clampedOff, y, bd/2+0.15);
  },

  _disposeGroup(g) {
    if (!g) return;
    g.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});
        else { if(c.material.map)c.material.map.dispose();c.material.dispose(); }
      }
    });
  },

  // =================================================================
  //  LEVEL DATA
  // =================================================================
  LEVELS: [
    {id:1,floors:100,waterSpeed:1.2,descZh:'100层·洪水急流'},
    {id:2,floors:200,waterSpeed:1.5,descZh:'200层·洪水狂奔'},
    {id:3,floors:300,waterSpeed:1.8,descZh:'300层·洪水汹涌'},
    {id:4,floors:400,waterSpeed:2.2,descZh:'400层·洪水咆哮'},
    {id:5,floors:500,waterSpeed:2.6,descZh:'500层·洪水怒涛'},
    {id:6,floors:600,waterSpeed:3.0,descZh:'600层·洪水暴虐'},
    {id:7,floors:700,waterSpeed:3.5,descZh:'700层·洪水灭顶'},
    {id:8,floors:800,waterSpeed:4.0,descZh:'800层·洪水滔天'},
    {id:9,floors:900,waterSpeed:4.6,descZh:'900层·洪水末日'},
    {id:10,floors:1000,waterSpeed:5.2,descZh:'1000层·终极洪水'},
  ],

  CHAR_SPEEDS: { athlete: 1.5, normal: 0.95, elder: 0.55 },
  CHAR_COLORS: { athlete: 0x4fc3f7, normal: 0x81c784, elder: 0xffb74d },

  _buildLevelData() {
    this.setData({ levels: this.LEVELS });
  },

  _loadProgress() {
    try {
      const v = wx.getStorageSync('flood_progress');
      if (v) { const n = parseInt(v, 10); if (n >= 1 && n <= 11) this.setData({ unlocked: n }); }
    } catch(e) {}
  },

  _saveProgress() {
    try { wx.setStorageSync('flood_progress', String(this.data.unlocked)); } catch(e) {}
  },

  // =================================================================
  //  UI EVENTS
  // =================================================================
  tapLevel(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    if (id > this.data.unlocked) return;
    this.setData({ selLvl: id });
  },

  tapChar(e) {
    this.setData({ charKey: e.currentTarget.dataset.char });
  },

  tapNight(e) {
    const v = e.currentTarget.dataset.night === '1';
    this.setData({ nightMode: v });
    if (this.renderer) this._applyDayNight();
  },

  showRules() { this.setData({ rulesShow: true }); },
  hideRules() { this.setData({ rulesShow: false }); },

  resetProgress() {
    const that = this;
    wx.showModal({
      title: '重置进度',
      content: '确定要重置所有关卡进度吗？',
      success(res) {
        if (res.confirm) {
          that.setData({ unlocked: 1, selLvl: 1 });
          that._saveProgress();
        }
      }
    });
  },

  goHome() {
    this._stopLoop();
    this.setData({
      state: 0, rulesShow: false, autoClimb: false,
      selLvl: Math.min(this.data.unlocked, 10)
    });
  },

  toggleAuto() {
    this.setData({ autoClimb: !this.data.autoClimb });
    if (this.data.autoClimb) this._makeAutoNoise();
  },

  viewCPU() { this._cpuLookTimer = 2.5; },

  // =================================================================
  //  START GAME
  // =================================================================
  startGame() {
    const lvlId = this.data.selLvl;
    if (!lvlId || lvlId > this.data.unlocked) return;

    const lvl = this.LEVELS.find(l => l.id === lvlId);
    if (!lvl) return;

    this._curLevel = lvl;
    this._waterSpeed = lvl.waterSpeed;
    this._playerFloor = 0;
    this._playerOffX = 0;
    this._waterLevel = 0;
    this._drownTime = 0;
    this._gameElapsed = 0;
    this._cpuFloor = 0;
    this._cpuOffX = 0;
    this._cpuDrownTime = 0;
    this._cpuAlive = true;
    this._cpuDeathTime = 0;
    this._cpuLookTimer = 0;
    this._cpuCharKey = ['athlete','normal','elder'][Math.floor(Math.random()*3)];
    this._shakeAmount = 0;
    this._cameraY = 0;
    this._mouseX = W * 0.48;
    this._mouseY = H * 0.3;
    this._gameStarted = false;
    this.setData({ state: 1, autoClimb: false, drownVisible: false });

    this._buildBuilding();
    this._createParticleSystem();
    this._createWater();
    this._createGround();
    this._createStars();
    this._createCursorDot();
    this._applyDayNight();

    if (this._playerGroup) { this.scene.remove(this._playerGroup); this._disposeGroup(this._playerGroup); }
    if (this._cpuGroup) { this.scene.remove(this._cpuGroup); this._disposeGroup(this._cpuGroup); }
    this._playerGroup = this._createPlayer(false);
    this.scene.add(this._playerGroup);
    this._playerGroup.__isCPU = false;
    this._cpuGroup = this._createPlayer(true);
    this.scene.add(this._cpuGroup);
    this._cpuGroup.__isCPU = true;

    // 更新光标平面位置
    if (this._cursorPlane) {
      this._cursorPlane.position.set(0, this._buildingH()/2, this._buildingD()/2+0.2);
    }

    this._updateHUD();
    this._lastTime = Date.now();
    this._startLoop();
  },

  nextLevel() {
    if (this._curLevel && this._curLevel.id < 10) {
      this.setData({ selLvl: this._curLevel.id + 1 });
      this.startGame();
    }
  },

  // =================================================================
  //  TOUCH INPUT
  // =================================================================
  onTouchStart(e) {
    const t = e.touches[0];
    this._mouseX = t.x;
    this._mouseY = t.y;
    this._mouseOnScreen = true;
  },
  onTouchMove(e) {
    const t = e.touches[0];
    this._mouseX = t.x;
    this._mouseY = t.y;
    this._mouseOnScreen = true;
  },
  onTouchEnd() {
    this._mouseOnScreen = false;
  },

  // =================================================================
  //  GAME LOOP
  // =================================================================
  _startLoop() {
    if (this._loopId) this._stopLoop();
    const canvas = this._canvas;
    const that = this;

    function frame() {
      that._tick();
      that._loopId = canvas.requestAnimationFrame(frame);
    }
    this._loopId = canvas.requestAnimationFrame(frame);
  },

  _stopLoop() {
    if (this._loopId && this._canvas) {
      this._canvas.cancelAnimationFrame(this._loopId);
      this._loopId = null;
    }
  },

  _tick() {
    const now = Date.now();
    let dt = (now - this._lastTime) / 1000;
    if (dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    this._lastTime = now;

    if (this.data.state !== 1) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 游戏开始后显示 HUD
    if (!this._gameStarted) {
      this._gameStarted = true;
    }

    this._update(dt);
    this._update3D(dt);
    this.renderer.render(this.scene, this.camera);
  },

  // =================================================================
  //  GAME LOGIC
  // =================================================================
  _GRACE: 10,
  _DROWN_LIMIT: 10,

  _update(dt) {
    if (this.data.state !== 1) return;
    this._gameElapsed += dt;

    const spd = this.CHAR_SPEEDS[this.data.charKey] || 0.95;
    const maxF = this._curLevel ? this._curLevel.floors : 100;

    // 自动攀爬
    if (this.data.autoClimb) {
      const prev = this._playerFloor;
      this._playerFloor += spd * dt;
      this._playerFloor = Math.min(maxF, this._playerFloor);
      if (Math.floor(this._playerFloor*4) !== Math.floor(prev*4)) {
        const p = this._getPlayerPos(this._playerFloor, this._playerOffX, false);
        this._spawnParticles(p.x, p.y, p.z, 2, '#cccccc', 0.2);
      }
    }

    // 触摸引导攀爬
    if (!this.data.autoClimb && this._mouseOnScreen) {
      const fh2D = this._floorH2D();
      const groundY2D = H * 0.88;
      const playerScreenY = groundY2D - (this._playerFloor + 0.5) * fh2D;
      if (this._mouseY < playerScreenY - fh2D * 0.05) {
        const prev = this._playerFloor;
        const dist = playerScreenY - this._mouseY;
        const mult = Math.min(2.5, 1.0 + dist / (fh2D * 2.5));
        this._playerFloor += spd * mult * dt;
        this._playerFloor = Math.min(maxF, this._playerFloor);
        if (Math.floor(this._playerFloor*4) !== Math.floor(prev*4)) {
          const p = this._getPlayerPos(this._playerFloor, this._playerOffX, false);
          this._spawnParticles(p.x, p.y, p.z, 2, '#cccccc', 0.2);
        }
      }
    }

    // 水平偏移
    const maxLean = W * 0.12;
    if (!this.data.autoClimb) {
      const stairX3D = this._stairX3D(this._playerFloor);
      const targetOffX = Math.max(-maxLean, Math.min(maxLean, this._mouseX - stairX3D));
      this._playerOffX += (targetOffX - this._playerOffX) * Math.min(1, dt*14);
    } else {
      this._playerOffX += (0 - this._playerOffX) * Math.min(1, dt*6);
    }

    if (this._cpuDeathTime > 0) this._cpuDeathTime -= dt;
    if (this._cpuLookTimer > 0) this._cpuLookTimer -= dt;

    // CPU 对手
    if (this._cpuAlive) {
      const cpuSpd = this.CHAR_SPEEDS[this._cpuCharKey] || 0.95;
      const pause = Math.sin(this._gameElapsed * 1.7 + 3) * 0.15;
      this._cpuFloor += Math.max(0.2, cpuSpd + pause) * dt;
      this._cpuFloor = Math.min(maxF, this._cpuFloor);

      const csx3D = this._stairX3D(this._cpuFloor);
      const tgt = csx3D + (Math.random()-0.5) * W * 0.06;
      this._cpuOffX += (tgt - (csx3D + this._cpuOffX)) * Math.min(1, dt*6);

      const cpuAbsY = H * 0.88 - (this._cpuFloor + 0.5) * this._floorH2D();
      if (cpuAbsY > this._waterScreenY()) {
        this._cpuDrownTime += dt;
      } else {
        this._cpuDrownTime = Math.max(0, this._cpuDrownTime - dt*0.3);
      }
      if (this._cpuDrownTime >= this._DROWN_LIMIT) {
        this._cpuAlive = false;
        this._cpuDeathTime = 3;
        this._onWin(true);
        return;
      }
    }

    // 水位上升
    if (this._gameElapsed >= this._GRACE) {
      this._waterLevel += this._waterSpeed * dt;
    }

    // 溺水检测
    const playerAbsY = H * 0.88 - (this._playerFloor + 0.5) * this._floorH2D();
    if (playerAbsY > this._waterScreenY()) {
      this._drownTime += dt;
      this._shakeAmount = Math.min(6, this._shakeAmount + dt*3);
      if (Math.random() < 0.3) {
        const p = this._getPlayerPos(this._playerFloor, this._playerOffX, false);
        this._spawnParticles(p.x, this._waterLevel*this._floorH3D(), p.z, 3, '#64b5f6', 0.5);
      }
    } else {
      this._drownTime = Math.max(0, this._drownTime - dt*0.3);
      this._shakeAmount = Math.max(0, this._shakeAmount - dt*5);
    }

    // 胜利：玩家到达楼顶
    if (this._playerFloor >= maxF) { this._onWin(false); return; }

    // CPU 先到楼顶
    if (this._cpuAlive && this._cpuFloor >= maxF) { this._onLose(true); return; }

    // 溺水死亡
    if (this._drownTime >= this._DROWN_LIMIT) { this._onLose(false); return; }

    this._updateHUD();
  },

  // =================================================================
  //  HUD 更新
  // =================================================================
  _updateHUD() {
    const pf = Math.max(0, Math.floor(this._playerFloor));
    const cf = Math.max(0, Math.floor(this._cpuFloor));
    let waterText, drownVis = false, drownPct = 0, drownCol = '';

    if (this._gameElapsed < this._GRACE) {
      waterText = (this._GRACE - this._gameElapsed).toFixed(1) + 's';
    } else {
      waterText = 'F' + Math.max(0, Math.floor(this._waterLevel));
    }

    if (this._drownTime > 0) {
      drownVis = true;
      drownPct = Math.round(this._drownTime / this._DROWN_LIMIT * 100);
      drownCol = this._drownTime > this._DROWN_LIMIT * 0.7
        ? 'linear-gradient(90deg,#ff5252,#e94560)'
        : 'linear-gradient(90deg,#4fc3f7,#ff9800)';
    }

    this.setData({
      hudTime: this._gameElapsed.toFixed(1),
      hudFloor: pf + 'F / CPU:' + cf + 'F',
      hudWater: waterText,
      drownVisible: drownVis,
      drownPct: drownPct,
      drownColor: drownCol
    });
  },

  // =================================================================
  //  2D 坐标辅助 (用于触摸映射)
  // =================================================================
  _floorH2D() {
    const avail = H * 0.78;
    const ef = this._effFloors();
    return Math.max(18, Math.min(40, avail / (ef + 1)));
  },
  _stairX3D(floor) {
    const bw = W * 0.33, bx = W * 0.30;
    const stairsX = bx + 4, stairsW = bw - 8;
    const fi = Math.floor(floor), frac = floor - fi;
    const goRight = (fi%2===0);
    const xs = goRight ? stairsX+stairsW*0.1 : stairsX+stairsW*0.65;
    const xe = goRight ? stairsX+stairsW*0.65 : stairsX+stairsW*0.1;
    return xs + (xe-xs)*frac;
  },
  _waterScreenY() { return H*0.88 - this._waterLevel*this._floorH2D(); },

  // =================================================================
  //  胜 / 负
  // =================================================================
  _onWin(cpuDrowned) {
    this.setData({ state: 2 });
    let msg = '用时 ' + this._gameElapsed.toFixed(1) + 's | 到达楼顶';
    if (cpuDrowned) msg += ' | 对手被淹死了';
    else msg += ' | CPU: ' + (this._cpuAlive ? '到达'+Math.floor(this._cpuFloor)+'F' : '已淹死');

    // 解锁
    let canNext = false;
    if (this._curLevel.id >= this.data.unlocked) {
      const newUnlock = this._curLevel.id + 1;
      this.setData({ unlocked: Math.min(newUnlock, 11) });
      this._saveProgress();
      this._buildLevelData();
      if (this._curLevel.id < 10) {
        msg += '\n🎉 第' + (this._curLevel.id+1) + '关已解锁!';
        canNext = true;
      } else {
        msg += '\n🎉 恭喜通关全部10关!';
      }
    }

    this.setData({
      winTitleText: cpuDrowned ? '对手被淹死了!' : '🏆 你赢了!',
      winMsg: msg,
      canNext: canNext
    });
  },

  _onLose(cpuBeat) {
    this.setData({ state: 3 });
    let msg = '你到达第' + Math.floor(this._playerFloor) + '层 | 用时' + this._gameElapsed.toFixed(1) + 's';
    if (cpuBeat) {
      msg = '对手先到达楼顶! | ' + msg;
    }
    msg += ' | CPU: ' + (this._cpuAlive ? Math.floor(this._cpuFloor)+'F' : '已淹死');

    this.setData({
      loseTitleText: cpuBeat ? '😞 对手先到了!' : '💀 你被淹死了',
      loseMsg: msg
    });
  },

  // =================================================================
  //  3D 更新 (每帧)
  // =================================================================
  _update3D(dt) {
    if (!this._playerGroup) return;

    const pPos = this._getPlayerPos(this._playerFloor, this._playerOffX, false);
    this._playerGroup.position.copy(pPos);

    const wy = this._waterLevel * this._floorH3D();
    const body = this._playerGroup.children.find(c => c.name === 'body');
    if (body) {
      const charCol = this.CHAR_COLORS[this.data.charKey] || 0x81c784;
      body.material.color.set(pPos.y < wy && this._drownTime > 0 ? 0x6496c8 : charCol);
    }

    const ring = this._playerGroup.children.find(c => c.name === 'ring');
    if (ring) {
      const pulse = 0.5 + 0.5 * Math.sin(this._gameElapsed*4);
      ring.material.opacity = 0.25 + pulse*0.5;
      ring.scale.setScalar(1 + pulse*0.25);
    }

    // 玩家抖动
    const playerAbsY = H*0.88 - (this._playerFloor+0.5)*this._floorH2D();
    if (this._mouseOnScreen && this._mouseY < playerAbsY - this._floorH2D()*0.05) {
      this._playerGroup.position.y += Math.sin(this._gameElapsed*14)*0.015;
    }

    // CPU
    if (this._cpuAlive && this._cpuGroup) {
      const cPos = this._getPlayerPos(this._cpuFloor, this._cpuOffX, true);
      this._cpuGroup.position.copy(cPos);
      this._cpuGroup.visible = true;
      const cBody = this._cpuGroup.children.find(c => c.name === 'body');
      if (cBody) cBody.material.color.set(cPos.y < wy && this._cpuDrownTime>0 ? 0xb47850 : 0xff8c42);
      const cRing = this._cpuGroup.children.find(c => c.name === 'ring');
      if (cRing) { const p = 0.5+0.5*Math.sin(this._gameElapsed*4+2); cRing.material.opacity = 0.2+p*0.45; cRing.scale.setScalar(1+p*0.2); }
    } else if (this._cpuGroup) {
      this._cpuGroup.visible = false;
    }

    this._updateWaterVisuals();
    this._updateParticles(dt);
    this._updateCamera(pPos.y);
    this._updateCursor();

    // 屏幕震动
    if (this._shakeAmount > 0.01) {
      this.camera.position.x += (Math.random()-0.5)*this._shakeAmount*0.015;
      this.camera.position.y += (Math.random()-0.5)*this._shakeAmount*0.015;
    }

    if (this._stars && Math.random() < 0.3) {
      this._stars.material.opacity = 0.5 + Math.sin(this._gameElapsed*3)*0.2;
    }
  },

  _updateCamera(playerY) {
    const bH = this._buildingH(), bw = this._buildingW(), bd = this._buildingD();
    const targetY = Math.max(2, Math.min(bH-1, playerY+1));
    this._cameraY += (targetY - this._cameraY)*0.04;

    const extra = Math.max(0, (bH-15)*0.12);
    let camZ = bd/2+10+extra*0.5, camX = bw/2+8+extra*0.3, camY = this._cameraY+5+extra*0.15;

    if (this._cpuLookTimer > 0 && this._cpuAlive) {
      const cp = this._getPlayerPos(this._cpuFloor, this._cpuOffX, true);
      const t = Math.min(1, this._cpuLookTimer/0.3);
      camY = cp.y+2; camX = cp.x+4; camZ = cp.z+5+t*2;
      this._cameraY += (cp.y-this._cameraY)*0.08;
    }

    this.camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.06);
    this.camera.lookAt(0, this._cameraY, 0);
  },

  _updateCursor() {
    if (!this._cursor || !this._cursorPlane || this.data.state !== 1) return;
    if (!this._mouseOnScreen) { this._cursor.visible = false; return; }

    // 屏幕坐标转 NDC
    const ndc = new THREE.Vector2(
      (this._mouseX / W) * 2 - 1,
      -(this._mouseY / H) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObject(this._cursorPlane);
    if (hits.length > 0) {
      this._cursor.position.copy(hits[0].point);
      this._cursor.visible = true;
      const pulse = 0.7 + 0.3 * Math.sin(this._gameElapsed*5);
      this._cursor.scale.setScalar(pulse);
    } else {
      this._cursor.visible = false;
    }
  },

  _makeAutoNoise() {
    // Auto-climb 已激活的声音/振动提示
    try { wx.vibrateShort({ type: 'light' }); } catch(e) {}
  },

  // =================================================================
  //  RENDER LOOP
  // =================================================================
  _loop() {
    const that = this;
    function frame() {
      that._tick();
      that._loopId = that._canvas.requestAnimationFrame(frame);
    }
    that._loopId = that._canvas.requestAnimationFrame(frame);
  },

});
