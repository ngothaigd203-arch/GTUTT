// ==========================================
// 1. CẤU HÌNH HỆ THỐNG (Lưu tại LocalStorage)
// ==========================================
const DEFAULT_CFG = {
    broker: "a768f4faac3d410cb9d94c9e149685c6.s1.eu.hivemq.cloud",
    port: 8884,
    user: "TRAFFIC",
    pass: "Traffic123",
    adminPass: "1234",
    top: {
        switch: "/its/sys/switch",
        l1p: "/its/lab1/telemetry", l1s: "/its/lab1/control",
        l2p: "/its/lab2/traffic_status", l2s: "/its/lab2/emergency",
        l3p: "/its/lab3/car_count", l3s: "/its/lab3/gate_control"
    }
};

let CFG = { ...DEFAULT_CFG };
let client = null;
let currentLabId = "4";
let isUserLoggedIn = false;

// ==========================================
// THÊM: QUẢN LÝ ÂM THANH (Web Audio API)
// ==========================================
const soundManager = {
    ctx: null,
    init: function () {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    playTone: function (freq, type, duration, vol) {
        try {
            if (!this.ctx) this.init();
            if (this.ctx.state === 'suspended') this.ctx.resume();
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) { }
    },
    ting: () => soundManager.playTone(800, 'sine', 0.5, 0.3),
    beep: () => soundManager.playTone(300, 'square', 0.3, 0.1),
    siren: () => {
        try {
            if (!soundManager.ctx) soundManager.init();
            if (soundManager.ctx.state === 'suspended') soundManager.ctx.resume();
            const osc = soundManager.ctx.createOscillator();
            const gain = soundManager.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, soundManager.ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(800, soundManager.ctx.currentTime + 0.5);
            osc.frequency.linearRampToValueAtTime(400, soundManager.ctx.currentTime + 1.0);
            gain.gain.setValueAtTime(0.2, soundManager.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.01, soundManager.ctx.currentTime + 1.0);
            osc.connect(gain);
            gain.connect(soundManager.ctx.destination);
            osc.start();
            osc.stop(soundManager.ctx.currentTime + 1.0);
        } catch (e) { }
    }
};

// ==========================================
// THÊM: QUẢN LÝ NHẬT KÝ SỰ KIỆN
// ==========================================
const logger = {
    logs: [],
    log: function (msg, type = 'info') {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
        this.logs.unshift({ time: timeStr, msg, type });
        if (this.logs.length > 100) this.logs.pop();
        this.render();
    },
    render: function () {
        const container = document.getElementById('logs-container');
        if (!container) return;
        container.innerHTML = '';
        this.logs.forEach(l => {
            const div = document.createElement('div');
            div.className = `log-item ${l.type}`;
            div.innerHTML = `<span class="log-time">${l.time}</span>${l.msg}`;
            container.appendChild(div);
        });
    },
    clear: function () {
        this.logs = [];
        this.render();
        ui.toast("Đã xóa nhật ký", "#f59e0b");
    },
    export: function () {
        if (this.logs.length === 0) return ui.toast("Nhật ký trống!", "#f59e0b");
        let csvContent = "data:text/csv;charset=utf-8,\uFEFFThời gian,Loại,Nội dung\n";
        this.logs.forEach(l => {
            let safeMsg = l.msg.replace(/"/g, '""');
            csvContent += `${l.time},${l.type},"${safeMsg}"\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `UTT_System_Logs_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        ui.toast("Đã xuất CSV Nhật ký", "#10b981");
    }
};

// ==========================================
// THÊM: QUẢN LÝ BIỂU ĐỒ (Chart.js)
// ==========================================
const chartManager = {
    chart: null,
    init: function () {
        const ctx = document.getElementById('distanceChart');
        if (!ctx) return;
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Khoảng cách (cm)',
                    data: [],
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#cbd5e1' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { display: false }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    },
    updateData: function (dist) {
        if (!this.chart) return;
        const now = new Date().toLocaleTimeString('vi-VN');
        this.chart.data.labels.push(now);
        this.chart.data.datasets[0].data.push(dist);
        if (this.chart.data.labels.length > 20) {
            this.chart.data.labels.shift();
            this.chart.data.datasets[0].data.shift();
        }
        this.chart.update();
    }
};

// Khởi tạo cài đặt từ LocalStorage
const appSettings = {
    init: () => {
        const saved = localStorage.getItem("ITS_CFG");
        if (saved) {
            const parsed = JSON.parse(saved);
            CFG = { ...CFG, ...parsed }; // Merge
        }
    },
    toggleModal: () => {
        const modal = document.getElementById('settings-modal');
        if (!modal.classList.contains('active')) {
            // Load current settings into inputs
            document.getElementById('cfg-broker').value = CFG.broker;
            document.getElementById('cfg-port').value = CFG.port;
            document.getElementById('cfg-user').value = CFG.user;
            document.getElementById('cfg-pass').value = CFG.pass;
            document.getElementById('cfg-admin-pass').value = CFG.adminPass;
            modal.classList.add('active');
        } else {
            modal.classList.remove('active');
        }
    },
    saveConfig: () => {
        CFG.broker = document.getElementById('cfg-broker').value.trim() || DEFAULT_CFG.broker;
        CFG.port = parseInt(document.getElementById('cfg-port').value) || DEFAULT_CFG.port;
        CFG.user = document.getElementById('cfg-user').value.trim();
        CFG.pass = document.getElementById('cfg-pass').value.trim();
        CFG.adminPass = document.getElementById('cfg-admin-pass').value.trim() || DEFAULT_CFG.adminPass;

        localStorage.setItem("ITS_CFG", JSON.stringify({
            broker: CFG.broker, port: CFG.port, user: CFG.user, pass: CFG.pass, adminPass: CFG.adminPass
        }));

        ui.toast("ĐÃ LƯU CẤU HÌNH!", "#10b981");
        appSettings.toggleModal();

        // Auto reconnect with new settings if was connected
        if (client && client.isConnected()) {
            mqtt.disconnect();
        }
        setTimeout(mqtt.connect, 500);
    }
};

// ==========================================
// 2. HỆ THỐNG XÁC THỰC CỤC BỘ (LOCAL AUTH)
// ==========================================
const appAuth = {
    login: () => {
        const user = document.getElementById('login-user').value;
        const pass = document.getElementById('login-pass').value;

        if (user === "admin" && pass === CFG.adminPass) {
            isUserLoggedIn = true;
            soundManager.ting();
            logger.log("Admin đăng nhập thành công", "success");
            ui.toast("ĐĂNG NHẬP THÀNH CÔNG!", "#10b981");

            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('locked'));
            document.getElementById('auth-title').innerText = "HỆ THỐNG MỞ KHÓA";
            document.getElementById('auth-desc').innerText = "Xin chào Admin. Chọn Tab để thao tác.";
            document.getElementById('auth-form').style.display = "none";
            document.getElementById('btn-logout').style.display = "block";

            document.getElementById('nav-lab1').click();
        } else {
            soundManager.beep();
            logger.log("Đăng nhập thất bại: Sai mật khẩu", "error");
            ui.toast("SAI TÀI KHOẢN HOẶC MẬT KHẨU!", "#ff4444");
        }
    },
    logout: () => {
        isUserLoggedIn = false;
        soundManager.beep();
        logger.log("Admin đăng xuất khỏi hệ thống", "warning");
        ui.toast("ĐÃ ĐĂNG XUẤT", "#f59e0b");

        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.getAttribute('data-lab') !== "4") btn.classList.add('locked');
        });

        document.getElementById('auth-title').innerText = "XÁC THỰC BẢO MẬT";
        document.getElementById('auth-desc').innerText = "Đăng nhập cục bộ để mở khóa hệ thống giám sát.";
        document.getElementById('auth-form').style.display = "flex";
        document.getElementById('btn-logout').style.display = "none";
        document.getElementById('login-pass').value = "";

        document.querySelector('[data-target="tab-intro"]').click();
    }
};

// ==========================================
// 3. QUẢN LÝ MQTT
// ==========================================
const mqtt = {
    connect: () => {
        if (!CFG.broker) return ui.toast("Vui lòng cấu hình Máy chủ trong phần Cài đặt!", "#f59e0b");
        const btn = document.getElementById('btn-mqtt');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ĐANG KẾT NỐI...';

        client = new Paho.MQTT.Client(CFG.broker, CFG.port, "/mqtt", "PRO_UI_" + Math.random().toString(16).slice(2));
        client.onMessageArrived = ui.handleMsg;
        client.onConnectionLost = () => ui.setStatus(false);

        const options = {
            useSSL: true,
            timeout: 5,
            onSuccess: () => {
                ui.setStatus(true);
                [CFG.top.l1p, CFG.top.l2p, CFG.top.l3p].forEach(t => client.subscribe(t));
                soundManager.ting();
                logger.log("Đã kết nối thành công tới Máy chủ MQTT", "success");
                ui.toast("KẾT NỐI HỆ THỐNG THÀNH CÔNG");
                mqtt.pub(CFG.top.switch, { lab: parseInt(currentLabId) });
            },
            onFailure: (err) => {
                soundManager.beep();
                logger.log("Lỗi kết nối MQTT: " + err.errorMessage, "error");
                ui.toast("LỖI KẾT NỐI: " + err.errorMessage, "#ff4444");
                btn.innerHTML = '<i class="fas fa-link"></i> KẾT NỐI LẠI';
            }
        };

        if (CFG.user && CFG.pass) {
            options.userName = CFG.user;
            options.password = CFG.pass;
        }

        try {
            client.connect(options);
        } catch (e) {
            ui.toast("Lỗi khởi tạo kết nối: " + e.message, "#ff4444");
            btn.innerHTML = '<i class="fas fa-link"></i> KẾT NỐI LẠI';
        }
    },
    disconnect: () => {
        if (client && client.isConnected()) {
            client.disconnect();
            ui.setStatus(false);
            ui.toast("ĐÃ NGẮT KẾT NỐI", "#ff4444");
        }
    },
    pub: (topic, payload) => {
        if (!client || !client.isConnected()) return ui.toast("YÊU CẦU KẾT NỐI MÁY CHỦ TRƯỚC!", "#ff4444");
        const msg = new Paho.MQTT.Message(JSON.stringify(payload));
        msg.destinationName = topic;
        client.send(msg);
        ui.toast(`Gửi lệnh: ${JSON.stringify(payload)}`);
    }
};

// ==========================================
// 4. BỘ ĐIỀU KHIỂN & GIAO DIỆN
// ==========================================
const ctrl = {
    l1Send: () => {
        // ParseInt để đảm bảo dữ liệu luôn là số nguyên, ngăn lỗi hệ thống ESP32
        const servoVal = parseInt(document.getElementById('l1-servo').value) || 0;
        const led1Val = parseInt(document.getElementById('l1-led1').value) || 0;
        const led2Val = parseInt(document.getElementById('l1-led2').value) || 0;

        const getLaneArray = (groupId) => {
            const activeBtn = document.querySelector(`#${groupId} .tl-btn.active`);
            const color = activeBtn ? activeBtn.getAttribute('data-color') : 'off';
            if (color === 'r') return [1, 0, 0];
            if (color === 'y') return [0, 1, 0];
            if (color === 'g') return [0, 0, 1];
            return [0, 0, 0];
        };

        mqtt.pub(CFG.top.l1s, {
            servo: servoVal,
            led1: led1Val,
            led2: led2Val,
            lane1: getLaneArray('l1-lane1-ctrl'),
            lane2: getLaneArray('l1-lane2-ctrl')
        });
    },
    l2Cfg: () => {
        const green = parseInt(document.getElementById('l2-cfg-g').value) || 5;
        const yellow = parseInt(document.getElementById('l2-cfg-y').value) || 2;
        mqtt.pub(CFG.top.l2s, { type: "config", green, yellow });
        logger.log(`L2: Cập nhật thời gian Xanh=${green}s, Vàng=${yellow}s`, "info");
    },
    l2Emer: (action) => {
        mqtt.pub(CFG.top.l2s, { type: "emergency", action });
        if (action === 'start') {
            soundManager.siren();
            logger.log("L2: KÍCH HOẠT CHẾ ĐỘ KHẨN CẤP!", "error");
        } else {
            logger.log("L2: Khôi phục chế độ bình thường", "success");
        }
    },
    l2NightMode: (action) => {
        let actualAction = action;
        if (action === 'toggle') {
            const btn = document.getElementById('btn-night');
            actualAction = btn.classList.contains('active-mode') ? 'stop' : 'start';
        }
        mqtt.pub(CFG.top.l2s, { type: "night_mode", action: actualAction });
        logger.log("L2: Chuyển chế độ Đêm (Nháy vàng) -> " + actualAction.toUpperCase(), "warning");
    },
    l2Pri: (lane) => {
        mqtt.pub(CFG.top.l2s, { type: "priority", lane });
        logger.log(`L2: Ưu tiên làn ${lane}`, "warning");
    },

    l3Cmd: (cmd) => {
        mqtt.pub(CFG.top.l3s, { cmd: cmd });
        logger.log(`L3: Lệnh điều khiển cổng - ${cmd.toUpperCase()}`, "info");
    },
    l3Cfg: () => {
        let val = parseInt(document.getElementById('l3-cfg-sensor').value);
        if (isNaN(val) || val < 3 || val > 100) return ui.toast("Ngưỡng cảm biến phải từ 3 đến 100cm!", "#f59e0b");
        mqtt.pub(CFG.top.l3s, { sensor: val });
        logger.log(`L3: Lưu NVS ngưỡng cảm biến: ${val}cm`, "warning");
        ui.toast("Đã gửi lệnh lưu NVS: " + val + "cm");
    },
    exportCSV: () => {
        const carCount = document.getElementById('l3-car').innerText;
        const cfgVal = document.getElementById('l3-current-cfg').innerText;
        const now = new Date().toLocaleString('vi-VN');
        let csvContent = "data:text/csv;charset=utf-8,\uFEFFThời gian xuất,Tổng số lượt xe,Ngưỡng cài đặt (cm)\n";
        csvContent += `"${now}",${carCount},${cfgVal}\n`;

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `UTT_ETC_Report_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        logger.log(`Đã xuất báo cáo lưu lượng xe ETC (Tổng: ${carCount})`, 'success');
        ui.toast("Đã tải xuống Báo cáo ETC", "#10b981");
    }
};

const ui = {
    handleMsg: (msg) => {
        try {
            const data = JSON.parse(msg.payloadString);
            if (msg.destinationName === CFG.top.l1p) ui.renderL1(data);
            if (msg.destinationName === CFG.top.l2p) ui.renderL2(data);
            if (msg.destinationName === CFG.top.l3p) ui.renderL3(data);
        } catch (e) { console.error("JSON Parse Error"); }
    },
    renderL1: (data) => {
        if (data.dist !== undefined) {
            document.getElementById('l1-dist').innerText = data.dist.toFixed(1);
            chartManager.updateData(data.dist);
        }
        const setIr = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.innerText = val === 0 ? "CÓ VẬT CẢN" : "TRỐNG";
                el.className = val === 0 ? "ir-val alert" : "ir-val safe";
            }
        };
        if (data.ir1 !== undefined) setIr('l1-ir1', data.ir1);
        if (data.ir2 !== undefined) setIr('l1-ir2', data.ir2);
    },
    renderL2: (data) => {
        if (data.l1 && data.l1.t !== undefined) document.getElementById('l2-t1').innerText = data.l1.t.toString().padStart(2, '0');
        if (data.l2 && data.l2.t !== undefined) document.getElementById('l2-t2').innerText = data.l2.t.toString().padStart(2, '0');

        const setLamps = (lane, color) => {
            document.querySelectorAll(`#l2-${lane}-R, #l2-${lane}-Y, #l2-${lane}-G`).forEach(l => l.classList.remove('active'));
            const target = document.getElementById(`l2-${lane}-${color}`);
            if (target) target.classList.add('active');
        };
        if (data.l1 && data.l1.c) setLamps('l1', data.l1.c);
        if (data.l2 && data.l2.c) setLamps('l2', data.l2.c);

        if (data.cfg_g !== undefined) document.getElementById('l2-current-g').innerText = data.cfg_g;
        if (data.cfg_y !== undefined) document.getElementById('l2-current-y').innerText = data.cfg_y;

        if (data.mode !== undefined) {
            const btnNight = document.getElementById('btn-night');
            if (btnNight) {
                if (data.mode === 'night') {
                    btnNight.classList.add('active-mode');
                    btnNight.style.boxShadow = "0 0 20px var(--yellow)";
                    btnNight.innerText = "TẮT CHẾ ĐỘ ĐÊM";
                } else {
                    btnNight.classList.remove('active-mode');
                    btnNight.style.boxShadow = "none";
                    btnNight.innerText = "CHẾ ĐỘ ĐÊM";
                }
            }
        }
    },
    renderL3: (data) => {
        if (data.car !== undefined) document.getElementById('l3-car').innerText = data.car;
        if (data.dist !== undefined) document.getElementById('l3-dist').innerText = data.dist + " cm";

        if (data.cfg !== undefined) {
            document.getElementById('l3-current-cfg').innerText = data.cfg;
        }

        const states = ["ĐÓNG", "ĐANG MỞ", "MỞ", "CHỜ XE QUA", "ĐANG ĐÓNG"];
        if (data.st !== undefined) {
            document.getElementById('l3-st').innerText = states[data.st] || "KHÔNG RÕ";
            const arm = document.getElementById('l3-arm');
            if (data.st >= 1 && data.st <= 3) arm.classList.add('open'); else arm.classList.remove('open');
        }
    },
    setStatus: (isOnline) => {
        document.getElementById('status-indicator').className = isOnline ? "status-dot online" : "status-dot offline";
        document.getElementById('status-text').innerText = isOnline ? "HỆ THỐNG TRỰC TUYẾN" : "MẤT KẾT NỐI";
        document.getElementById('status-text').style.color = isOnline ? "var(--green)" : "var(--red)";

        document.getElementById('btn-mqtt').style.display = isOnline ? "none" : "flex";
        document.getElementById('btn-mqtt-off').style.display = isOnline ? "flex" : "none";
        if (!isOnline) document.getElementById('btn-mqtt').innerHTML = '<i class="fas fa-link"></i> KẾT NỐI LẠI';
    },
    toast: (msg, bgColor = "#f97316") => {
        const box = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = 'toast'; t.style.background = bgColor;
        t.style.color = (bgColor === "#f97316" || bgColor === "#10b981" || bgColor === "#f59e0b") ? "#000" : "#fff";
        t.innerText = msg;
        box.appendChild(t); setTimeout(() => t.remove(), 3500);
    },
    togglePassword: (inputId, iconElement) => {
        const input = document.getElementById(inputId);
        if (input.type === "password") {
            input.type = "text";
            iconElement.classList.remove("fa-eye");
            iconElement.classList.add("fa-eye-slash");
        } else {
            input.type = "password";
            iconElement.classList.remove("fa-eye-slash");
            iconElement.classList.add("fa-eye");
        }
    },
    selectTL: (groupId, color) => {
        document.querySelectorAll(`#${groupId} .tl-btn`).forEach(b => b.classList.remove('active'));
        const target = document.querySelector(`#${groupId} .tl-btn[data-color="${color}"]`);
        if (target) target.classList.add('active');
    },
    toggleLogs: () => {
        const drawer = document.getElementById('logs-drawer');
        drawer.classList.toggle('active');
    }
};

// --- INIT LISTENERS ---
appSettings.init();
chartManager.init();

document.getElementById('btn-mqtt').onclick = mqtt.connect;

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
        const targetBtn = e.currentTarget;

        if (targetBtn.classList.contains('locked')) {
            ui.toast("VUI LÒNG ĐĂNG NHẬP ĐỂ MỞ KHÓA!", "#ff4444");
            return;
        }

        document.querySelectorAll('.tab-btn, .panel').forEach(el => el.classList.remove('active'));
        targetBtn.classList.add('active');
        document.getElementById(targetBtn.getAttribute('data-target')).classList.add('active');

        currentLabId = targetBtn.getAttribute('data-lab');
        if (client && client.isConnected()) mqtt.pub(CFG.top.switch, { lab: parseInt(currentLabId) });
    };
});
