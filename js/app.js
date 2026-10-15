'use strict';
/* Bike Service Tracker BD  -- DOM layer. Depends on js/logic.js (global scope). */
(function () {
  var LS_KEY = 'bike-service-tracker-bd-v1';
  var asof = new URLSearchParams(location.search).get('asof') || '';
  var today = getToday(asof);
  var state = load();
  var activeTab = 'dashboard';
  var editingBikeId = null;
  var editingServiceId = null;
  var serviceFilter = 'all';

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return emptyState();
      var res = importData(raw);
      if (res.ok) return res.state;
      return emptyState();
    } catch (e) { return emptyState(); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, exportData(state)); } catch (e) { /* storage full/blocked: keep in-memory */ }
  }
  function lang() { return state.lang; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return localizeNum(String(n), lang()); }
  function money(p) { return fmtMoney(p, lang()); }
  function moneyShort(p) { return fmtMoneyShort(p, lang()); }
  function $(id) { return document.getElementById(id); }

  function showToast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  /* ---------- render ---------- */
  function render() {
    document.documentElement.lang = lang() === 'bn' ? 'bn' : 'en';
    $('appTitle').textContent = t('appTitle', lang());
    $('tagline').textContent = t('tagline', lang());
    $('langBtn').textContent = t('langBtn', lang());
    document.title = t('appTitle', lang());
    $('footerNote').textContent = t('disclaimer', lang());
    ['dashboard', 'bikes', 'services', 'data'].forEach(function (tab) {
      $('tab-' + tab).textContent = t('tab' + tab.charAt(0).toUpperCase() + tab.slice(1), lang());
      $('tab-' + tab).classList.toggle('active', activeTab === tab);
      $('panel-' + tab).classList.toggle('hidden', activeTab !== tab);
    });
    renderDashboard();
    renderBikes();
    renderServices();
    renderData();
  }

  function renderDashboard() {
    var tot = totals(state);
    $('statSpent').textContent = moneyShort(tot.totalPaisa);
    $('statServices').textContent = num(tot.services);
    $('statBikes').textContent = num(tot.bikes);
    var allRange = 0, allCost = 0;
    state.bikes.forEach(function (b) {
      var st = bikeStats(b, state.services);
      allRange += st.rangeKm; allCost += st.totalPaisa;
    });
    $('statCpk').textContent = allRange > 0 ? money(Math.round(allCost / allRange)) : '\u2014';
    $('lblSpent').textContent = t('totalSpent', lang());
    $('lblServices').textContent = t('servicesLogged', lang());
    $('lblBikes').textContent = t('bikesCount', lang());
    $('lblCpk').textContent = t('costPerKm', lang());

    var dues = dueItems(state, today);
    $('upcomingTitle').textContent = t('upcoming', lang());
    var dueEl = $('dueList');
    if (!dues.length) {
      dueEl.innerHTML = '<p class="muted">' + esc(t('noDue', lang())) + '</p>';
    } else {
      dueEl.innerHTML = dues.map(function (d) {
        var badge = d.status === 'overdue' ? t('overdue', lang()) : t('dueSoon', lang());
        var detail = t(d.reason, lang()).replace('{n}', num(d.n));
        return '<div class="due-row ' + d.status + '"><div><strong>' + esc(d.bike.name) + '</strong> \u00b7 ' +
          esc(tType(d.type, lang())) + '<div class="muted small">' + esc(detail) + '</div></div>' +
          '<span class="badge ' + d.status + '">' + esc(badge) + '</span></div>';
      }).join('');
    }
    var recent = state.services.slice().sort(function (a, b) {
      return (b.date + '|' + String(b.odo).padStart(9, '0')).localeCompare(a.date + '|' + String(a.odo).padStart(9, '0'));
    }).slice(0, 5);
    $('recentTitle').textContent = t('recentServices', lang());
    var recEl = $('recentList');
    if (!recent.length) {
      recEl.innerHTML = '<p class="muted">' + esc(t('noServices', lang())) + '</p>';
    } else {
      recEl.innerHTML = recent.map(function (s) {
        var bike = state.bikes.find(function (b) { return b.id === s.bikeId; });
        return '<div class="row-line"><div><strong>' + esc(tType(s.type, lang())) + '</strong> \u00b7 ' +
          esc(bike ? bike.name : '?') + '<div class="muted small">' + esc(s.date) + ' \u00b7 ' +
          num(s.odo) + ' km' + (s.garage ? ' \u00b7 ' + esc(s.garage) : '') + '</div></div>' +
          '<strong>' + money(s.costPaisa) + '</strong></div>';
      }).join('');
    }
  }

  function renderBikes() {
    $('bikeFormTitle').textContent = editingBikeId ? t('editBike', lang()) : t('addBike', lang());
    $('lblBikeName').textContent = t('bikeName', lang());
    $('lblModel').textContent = t('model', lang());
    $('lblPlate').textContent = t('plate', lang());
    $('lblPurchase').textContent = t('purchaseDate', lang());
    $('lblOdo').textContent = t('currentOdo', lang());
    $('bikeSaveBtn').textContent = t('save', lang());
    $('bikeCancelBtn').textContent = t('cancel', lang());
    $('bikeCancelBtn').classList.toggle('hidden', !editingBikeId);
    var list = $('bikeList');
    if (!state.bikes.length) {
      list.innerHTML = '<p class="muted">' + esc(t('noBikes', lang())) + '</p>';
      return;
    }
    list.innerHTML = state.bikes.map(function (b) {
      var st = bikeStats(b, state.services);
      return '<div class="card"><div class="card-head"><div><strong>' + esc(b.name) + '</strong>' +
        (b.model ? ' \u00b7 ' + esc(b.model) : '') +
        (b.plate ? '<div class="muted small">' + esc(b.plate) + '</div>' : '') + '</div>' +
        '<div class="btn-row"><button class="btn small" data-edit-bike="' + b.id + '">' + esc(t('edit', lang())) + '</button>' +
        '<button class="btn small danger" data-del-bike="' + b.id + '">' + esc(t('del', lang())) + '</button></div></div>' +
        '<div class="meta-grid"><div><span class="muted small">' + esc(t('currentOdo', lang())) + '</span><br><strong>' + num(b.odo) + ' km</strong></div>' +
        '<div><span class="muted small">' + esc(t('servicesLogged', lang())) + '</span><br><strong>' + num(st.count) + '</strong></div>' +
        '<div><span class="muted small">' + esc(t('totalSpent', lang())) + '</span><br><strong>' + money(st.totalPaisa) + '</strong></div>' +
        '<div><span class="muted small">' + esc(t('lastService', lang())) + '</span><br><strong>' + esc(st.lastDate || '\u2014') + '</strong></div></div>' +
        '<div class="btn-row"><button class="btn small" data-odo-bike="' + b.id + '">' + esc(t('updateOdo', lang())) + '</button></div></div>';
    }).join('');
  }

  function renderServices() {
    $('serviceFormTitle').textContent = editingServiceId ? t('editService', lang()) : t('addService', lang());
    $('lblSvcBike').textContent = t('bikeName', lang());
    $('lblSvcDate').textContent = t('date', lang());
    $('lblSvcOdo').textContent = t('odometer', lang());
    $('lblSvcType').textContent = t('serviceType', lang());
    $('lblSvcGarage').textContent = t('garage', lang());
    $('lblSvcCost').textContent = t('cost', lang());
    $('lblSvcParts').textContent = t('parts', lang());
    $('lblSvcNextOdo').textContent = t('nextOdo', lang());
    $('lblSvcNextDate').textContent = t('nextDate', lang());
    $('lblSvcNote').textContent = t('note', lang());
    $('svcSaveBtn').textContent = t('save', lang());
    $('svcCancelBtn').textContent = t('cancel', lang());
    $('svcCancelBtn').classList.toggle('hidden', !editingServiceId);
    $('lblFilter').textContent = t('bikeName', lang());
    $('historyTitle').textContent = t('serviceHistory', lang());

    var sel = $('svcBike');
    var cur = sel.value;
    sel.innerHTML = state.bikes.map(function (b) {
      return '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    }).join('');
    if (state.bikes.some(function (b) { return b.id === cur; })) sel.value = cur;

    var typeSel = $('svcType');
    var curType = typeSel.value;
    typeSel.innerHTML = SERVICE_TYPES.map(function (ty) {
      return '<option value="' + ty.id + '">' + esc(tType(ty.id, lang())) + '</option>';
    }).join('');
    if (curType) typeSel.value = curType;

    var fsel = $('svcFilter');
    var curF = serviceFilter;
    fsel.innerHTML = '<option value="all">' + esc(t('allBikes', lang())) + '</option>' +
      state.bikes.map(function (b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join('');
    fsel.value = state.bikes.some(function (b) { return b.id === curF; }) ? curF : 'all';

    var rows = state.services.filter(function (s) { return serviceFilter === 'all' || s.bikeId === serviceFilter; })
      .slice().sort(function (a, b) { return (b.date + '|' + String(b.odo).padStart(9, '0')).localeCompare(a.date + '|' + String(a.odo).padStart(9, '0')); });
    var hist = $('serviceHistory');
    if (!rows.length) {
      hist.innerHTML = '<p class="muted">' + esc(t('noServices', lang())) + '</p>';
      return;
    }
    hist.innerHTML = rows.map(function (s) {
      var bike = state.bikes.find(function (b) { return b.id === s.bikeId; });
      var nextBits = [];
      if (s.nextOdo !== null && s.nextOdo !== undefined && s.nextOdo !== '') nextBits.push(t('byKm', lang()).replace('{n}', num(s.nextOdo)));
      if (s.nextDate) nextBits.push(t('byDate', lang()).replace('{n}', s.nextDate));
      return '<div class="row-line"><div><strong>' + esc(tType(s.type, lang())) + '</strong> \u00b7 ' + esc(bike ? bike.name : '?') +
        '<div class="muted small">' + esc(s.date) + ' \u00b7 ' + num(s.odo) + ' km' +
        (s.garage ? ' \u00b7 ' + esc(s.garage) : '') +
        (s.parts ? ' \u00b7 ' + esc(s.parts) : '') +
        (nextBits.length ? '<br>' + esc(t('upcoming', lang()) + ': ' + nextBits.join(', ')) : '') +
        (s.note ? '<br>' + esc(s.note) : '') + '</div></div>' +
        '<div class="right"><strong>' + money(s.costPaisa) + '</strong><div class="btn-row">' +
        '<button class="btn small" data-edit-svc="' + s.id + '">' + esc(t('edit', lang())) + '</button>' +
        '<button class="btn small danger" data-del-svc="' + s.id + '">' + esc(t('del', lang())) + '</button></div></div></div>';
    }).join('');
  }

  function renderData() {
    $('exportBtn').textContent = t('export', lang());
    $('importLabel').textContent = t('import', lang());
    $('clearBtn').textContent = t('clearAll', lang());
    $('lblConfirm').textContent = t('typeDelete', lang());
    $('clearConfirmBtn').textContent = t('clearAll', lang());
  }

  /* ---------- forms ---------- */
  function fillBikeForm(bike) {
    $('bikeName').value = bike ? bike.name : '';
    $('bikeModel').value = bike ? bike.model : '';
    $('bikePlate').value = bike ? bike.plate : '';
    $('bikePurchase').value = bike ? bike.purchaseDate : '';
    $('bikeOdo').value = bike ? String(bike.odo) : '';
    $('bikeErr').textContent = '';
  }
  function fillServiceForm(svc) {
    $('svcDate').value = svc ? svc.date : today;
    $('svcOdo').value = svc ? String(svc.odo) : '';
    $('svcGarage').value = svc ? svc.garage : '';
    $('svcCost').value = svc ? (svc.costPaisa / 100).toFixed(2) : '';
    $('svcParts').value = svc ? svc.parts : '';
    $('svcNextOdo').value = (svc && svc.nextOdo !== null && svc.nextOdo !== undefined) ? String(svc.nextOdo) : '';
    $('svcNextDate').value = svc ? svc.nextDate : '';
    $('svcNote').value = svc ? svc.note : '';
    $('svcErr').textContent = '';
    if (svc) {
      $('svcBike').value = svc.bikeId;
      $('svcType').value = svc.type;
    }
  }
  function applyPreset() {
    var typeId = $('svcType').value;
    var odo = parseInt($('svcOdo').value, 10);
    var date = $('svcDate').value;
    if (isNaN(odo) || !isValidDateStr(date)) return;
    var p = presetNext(odo, date, typeId);
    $('svcNextOdo').value = p.nextOdo === null ? '' : String(p.nextOdo);
    $('svcNextDate').value = p.nextDate;
  }

  function onBikeSubmit(e) {
    e.preventDefault();
    var odo = parseInt($('bikeOdo').value, 10);
    var bike = {
      id: editingBikeId || uid(),
      name: $('bikeName').value.trim(),
      model: $('bikeModel').value.trim(),
      plate: $('bikePlate').value.trim(),
      purchaseDate: $('bikePurchase').value,
      odo: isNaN(odo) ? NaN : odo
    };
    var errs = validateBike(bike, today);
    if (errs.length) {
      $('bikeErr').textContent = errs.map(function (k) { return t('err' + k.charAt(0).toUpperCase() + k.slice(1), lang()); }).join(' ');
      return;
    }
    if (editingBikeId) {
      var idx = state.bikes.findIndex(function (b) { return b.id === editingBikeId; });
      if (idx >= 0) state.bikes[idx] = bike;
    } else state.bikes.push(bike);
    editingBikeId = null;
    save(); fillBikeForm(null); render();
  }
  function onServiceSubmit(e) {
    e.preventDefault();
    var cost = parseBdtToPaisa($('svcCost').value);
    var svc = {
      id: editingServiceId || uid(),
      bikeId: $('svcBike').value,
      date: $('svcDate').value,
      odo: parseInt($('svcOdo').value, 10),
      type: $('svcType').value,
      garage: $('svcGarage').value.trim(),
      costPaisa: cost === null ? NaN : cost,
      parts: $('svcParts').value.trim(),
      nextOdo: $('svcNextOdo').value.trim() === '' ? null : parseInt($('svcNextOdo').value, 10),
      nextDate: $('svcNextDate').value,
      note: $('svcNote').value.trim()
    };
    if (isNaN(svc.odo)) svc.odo = NaN;
    if (svc.nextOdo !== null && isNaN(svc.nextOdo)) svc.nextOdo = NaN;
    var errs = validateService(svc, state, today);
    if (errs.length) {
      $('svcErr').textContent = errs.map(function (k) { return t('err' + k.charAt(0).toUpperCase() + k.slice(1), lang()); }).join(' ');
      return;
    }
    if (editingServiceId) {
      var idx = state.services.findIndex(function (s) { return s.id === editingServiceId; });
      if (idx >= 0) state.services[idx] = svc;
    } else state.services.push(svc);
    // Keep the bike's current odometer at least this reading.
    var bike = state.bikes.find(function (b) { return b.id === svc.bikeId; });
    if (bike && svc.odo > bike.odo) bike.odo = svc.odo;
    editingServiceId = null;
    save(); fillServiceForm(null); render();
  }

  function bind() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.dataset.tab; render(); });
    });
    $('langBtn').addEventListener('click', function () {
      state.lang = state.lang === 'bn' ? 'en' : 'bn';
      save(); render();
    });
    $('bikeForm').addEventListener('submit', onBikeSubmit);
    $('bikeCancelBtn').addEventListener('click', function () { editingBikeId = null; fillBikeForm(null); render(); });
    $('svcForm').addEventListener('submit', onServiceSubmit);
    $('svcCancelBtn').addEventListener('click', function () { editingServiceId = null; fillServiceForm(null); render(); });
    $('svcType').addEventListener('change', applyPreset);
    $('svcOdo').addEventListener('change', applyPreset);
    $('svcDate').addEventListener('change', applyPreset);
    $('svcFilter').addEventListener('change', function () { serviceFilter = $('svcFilter').value; render(); });

    document.addEventListener('click', function (e) {
      var tEl = e.target.closest('[data-edit-bike],[data-del-bike],[data-odo-bike],[data-edit-svc],[data-del-svc]');
      if (!tEl) return;
      if (tEl.hasAttribute('data-edit-bike')) {
        editingBikeId = tEl.getAttribute('data-edit-bike');
        fillBikeForm(state.bikes.find(function (b) { return b.id === editingBikeId; }));
        activeTab = 'bikes'; render();
        $('bikeForm').scrollIntoView();
      } else if (tEl.hasAttribute('data-del-bike')) {
        var bid = tEl.getAttribute('data-del-bike');
        if (!confirm(t('confirmDeleteBike', lang()))) return;
        state.bikes = state.bikes.filter(function (b) { return b.id !== bid; });
        state.services = state.services.filter(function (s) { return s.bikeId !== bid; });
        if (serviceFilter === bid) serviceFilter = 'all';
        save(); render();
      } else if (tEl.hasAttribute('data-odo-bike')) {
        var ob = state.bikes.find(function (b) { return b.id === tEl.getAttribute('data-odo-bike'); });
        var val = prompt(t('updateOdo', lang()), String(ob.odo));
        if (val === null) return;
        var n = parseInt(val, 10);
        if (isNaN(n) || n < 0) { showToast(t('errInvalidOdo', lang()), true); return; }
        ob.odo = n; save(); render();
      } else if (tEl.hasAttribute('data-edit-svc')) {
        editingServiceId = tEl.getAttribute('data-edit-svc');
        var svc = state.services.find(function (s) { return s.id === editingServiceId; });
        fillServiceForm(svc);
        activeTab = 'services'; render();
        $('svcForm').scrollIntoView();
      } else if (tEl.hasAttribute('data-del-svc')) {
        if (!confirm(t('confirmDeleteService', lang()))) return;
        var sid = tEl.getAttribute('data-del-svc');
        state.services = state.services.filter(function (s) { return s.id !== sid; });
        save(); render();
      }
    });

    $('exportBtn').addEventListener('click', function () {
      var blob = new Blob([exportData(state)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bike-service-tracker-bd.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('importFile').addEventListener('change', function () {
      var f = $('importFile').files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var res = importData(String(r.result));
        if (res.ok) { state = res.state; save(); render(); showToast(t('importOk', lang())); }
        else showToast(t('importBad', lang()), true);
        $('importFile').value = '';
      };
      r.readAsText(f);
    });
    $('clearBtn').addEventListener('click', function () {
      $('clearBox').classList.toggle('hidden');
    });
    $('clearConfirmBtn').addEventListener('click', function () {
      if ($('deleteInput').value.trim() !== 'DELETE') { showToast(t('typeDelete', lang()), true); return; }
      var keepLang = state.lang;
      state = emptyState();
      state.lang = keepLang;
      editingBikeId = null; editingServiceId = null; serviceFilter = 'all';
      save(); fillBikeForm(null); fillServiceForm(null);
      $('deleteInput').value = ''; $('clearBox').classList.add('hidden');
      render(); showToast(t('cleared', lang()));
    });
  }

  fillBikeForm(null);
  fillServiceForm(null);
  bind();
  render();
})();
