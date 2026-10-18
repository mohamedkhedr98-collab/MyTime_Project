(function (window, document) {
  'use strict';

  var namespace = window.SRCalculator = window.SRCalculator || {};
  var core = namespace.core;
  namespace.internet = namespace.internet || {};
  namespace.landline = namespace.landline || {};
  namespace.router = namespace.router || {};

  function byId(id) { return document.getElementById(id); }
  function createOption(value, text) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }
  function getMode() {
    var selector = byId('calculatorServiceType');
    return selector && selector.value === 'landline' ? 'landline' : 'internet';
  }
  function runInternetCalculate() {
    if (typeof window.calculatePrice === 'function') window.calculatePrice();
  }
  function currentExtras() {
    var extrasSelect = byId('landlineExtras');
    var category = byId('landlineCategory') && byId('landlineCategory').value === 'business' ? 'business' : 'residential';
    var source = category === 'business' ? namespace.commercialExtras : namespace.landlineExtras;
    if (!extrasSelect || !Array.isArray(source)) return [];
    return Array.prototype.slice.call(extrasSelect.selectedOptions || []).map(function (option) {
      return source[parseInt(option.value, 10)];
    }).filter(Boolean);
  }
  function syncExtrasFromCheckboxes() {
    var extrasSelect = byId('landlineExtras');
    var extrasList = byId('landlineExtrasList');
    if (!extrasSelect || !extrasList) return;
    Array.prototype.slice.call(extrasSelect.options || []).forEach(function (option) {
      var checkbox = extrasList.querySelector('input[type=\"checkbox\"][value=\"' + option.value + '\"]');
      option.selected = !!(checkbox && checkbox.checked);
    });
    namespace.router.dispatch();
  }
  function updateExtrasSummary() {
    var extrasSummary = byId('landlineExtrasSummary');
    if (!extrasSummary) return;
    var selected = Array.prototype.slice.call((byId('landlineExtras') || {}).selectedOptions || []);
    extrasSummary.textContent = selected.length ? selected.length + ' selected' : 'No extras selected';
  }
  function zeroLandlineResult() {
    return { baseAmount: 0, extrasAmount: 0, cpeAmount: 0, balanceDeduction: 0, taxAmount: 0, finalAmount: 0, taxableAmount: 0 };
  }
  function renderLandlineResults(result) {
    var fields = {
      landlineBaseAmount: result.baseAmount,
      landlineExtrasAmount: result.extrasAmount,
      landlineCpeAmount: result.cpeAmount,
      landlineBalanceDeduction: result.balanceDeduction,
      landlineTaxAmount: result.taxAmount,
      landlineFinalAmount: result.finalAmount,
      priceWithoutTax: result.taxableAmount,
      priceWithTax: result.finalAmount
    };
    Object.keys(fields).forEach(function (id) {
      var element = byId(id);
      if (element) element.value = core.formatMoney(fields[id]);
      var valueElement = byId(id + 'Display');
      if (valueElement) valueElement.textContent = core.formatMoney(fields[id]);
    });
    updateExtrasSummary();
  }
  function clearLandlineSelections() {
    var packageSelect = byId('landlinePackage');
    var periodSelect = byId('landlinePeriod');
    var extrasSelect = byId('landlineExtras');
    var extrasList = byId('landlineExtrasList');
    var balance = byId('balance');
    if (packageSelect) packageSelect.value = '';
    if (periodSelect) periodSelect.innerHTML = '';
    if (extrasSelect) Array.prototype.slice.call(extrasSelect.options || []).forEach(function (option) { option.selected = false; });
    if (extrasList) Array.prototype.slice.call(extrasList.querySelectorAll('input[type=\"checkbox\"]')).forEach(function (checkbox) { checkbox.checked = false; });
    ['service1', 'service2', 'service3', 'service4'].forEach(function (id) {
      var button = byId(id);
      if (button) button.classList.remove('active');
    });
    if (balance) balance.value = '';
    updateExtrasSummary();
    renderLandlineResults(zeroLandlineResult());
  }
  function calculateLandlineFromDom() {
    var packageSelect = byId('landlinePackage');
    var periodSelect = byId('landlinePeriod');
    var result = namespace.calculateLandline({
      category: byId('landlineCategory') && byId('landlineCategory').value,
      packageName: packageSelect && packageSelect.value,
      period: periodSelect && periodSelect.value,
      extras: currentExtras(),
      cpeAmount: core.getSelectedCpeAmount(document),
      balance: byId('balance') && byId('balance').value
    });
    renderLandlineResults(result);
    return result;
  }
  function populatePackages() {
    var category = byId('landlineCategory') && byId('landlineCategory').value === 'business' ? 'business' : 'residential';
    var packageSelect = byId('landlinePackage');
    if (!packageSelect) return;
    packageSelect.innerHTML = '';
    packageSelect.appendChild(createOption('', 'Select Package'));
    (namespace.landlinePackages[category] || []).forEach(function (item) {
      packageSelect.appendChild(createOption(item.name, item.name));
    });
    populatePeriods();
    populateExtras();
  }
  function populatePeriods() {
    var category = byId('landlineCategory') && byId('landlineCategory').value === 'business' ? 'business' : 'residential';
    var packageName = byId('landlinePackage') && byId('landlinePackage').value;
    var packageConfig = (namespace.landlinePackages[category] || []).find(function (item) { return item.name === packageName; });
    var periods = packageConfig && packageConfig.periods ? Object.keys(packageConfig.periods) : [];
    var periodSelect = byId('landlinePeriod');
    var periodWrap = byId('landlinePeriodWrap');
    if (!periodSelect) return;
    periodSelect.innerHTML = '';
    if (periods.length) periodSelect.appendChild(createOption('', 'Select Period'));
    periods.forEach(function (period) { periodSelect.appendChild(createOption(period, period.charAt(0).toUpperCase() + period.slice(1))); });
    if (periodWrap) periodWrap.hidden = periods.length === 0;
    calculateLandlineFromDom();
  }
  function populateExtras() {
    var category = byId('landlineCategory') && byId('landlineCategory').value === 'business' ? 'business' : 'residential';
    var extrasSelect = byId('landlineExtras');
    var extrasList = byId('landlineExtrasList');
    var source = category === 'business' ? namespace.commercialExtras : namespace.landlineExtras;
    if (!extrasSelect) return;
    extrasSelect.innerHTML = '';
    if (extrasList) extrasList.innerHTML = '';
    source.forEach(function (extra, index) {
      var label = extra.name + ' (' + core.formatMoney(extra.price) + ')';
      if (extra.freeMinutes) label += ' - ' + extra.freeMinutes + ' min';
      extrasSelect.appendChild(createOption(String(index), label));
      if (extrasList) {
        var item = document.createElement('label');
        item.className = 'landline-extra-option';
        item.innerHTML = '<input type=\"checkbox\" value=\"' + index + '\"> <span>' + label + '</span>';
        extrasList.appendChild(item);
      }
    });
    updateExtrasSummary();
    calculateLandlineFromDom();
  }
  function tagInternetGroups() {
    ['products'].forEach(function (id) {
      var element = byId(id);
      if (element && !element.getAttribute('data-calculator-group')) {
        element.setAttribute('data-calculator-group', 'internet');
      }
    });
    [
      'discount1', 'discount2', 'extra30', 'extra50', 'extra100',
      'gigaTank400', 'gigaTank2000', 'gameOn400', 'op10', 'op20', 'op30', 'add1', 'add2'
    ].forEach(function (id) {
      var element = byId(id);
      var group = element && element.closest ? element.closest('.button-group') : element;
      if (group && !group.getAttribute('data-calculator-group')) {
        group.setAttribute('data-calculator-group', 'internet');
      }
    });
  }
  function setGroup(groupName, hidden) {
    Array.prototype.slice.call(document.querySelectorAll('[data-calculator-group="' + groupName + '"]')).forEach(function (element) {
      element.hidden = hidden;
    });
  }
  function applyMode() {
    var isLandline = getMode() === 'landline';
    setGroup('internet', isLandline);
    setGroup('landline', !isLandline);
    namespace.router.dispatch();
  }
  function bindRoutingEvents() {
    var cpeButtons = ['service1', 'service2', 'service3', 'service4'];
    cpeButtons.forEach(function (id) {
      var button = byId(id);
      if (button && !button.getAttribute('data-calculator-router-bound')) {
        button.setAttribute('data-calculator-router-bound', 'true');
        button.addEventListener('click', function () {
          if (getMode() === 'landline') setTimeout(namespace.router.dispatch, 0);
        });
      }
    });
    var resetButton = byId('reset1');
    if (resetButton && !resetButton.getAttribute('data-calculator-router-bound')) {
      resetButton.setAttribute('data-calculator-router-bound', 'true');
      resetButton.addEventListener('click', function () {
        var wasLandline = getMode() === 'landline';
        setTimeout(function () {
          if (wasLandline) {
            var selector = byId('calculatorServiceType');
            if (selector) selector.value = 'landline';
            clearLandlineSelections();
          }
          applyMode();
        }, 0);
      });
    }
  }
  function installLandlineStyles() {
    if (byId('landlineCalculatorStyles')) return;
    var style = document.createElement('style');
    style.id = 'landlineCalculatorStyles';
    style.textContent = [
      '#landlineControls{display:flex;flex-direction:column;gap:10px;margin:12px 0;}',
      '#landlineControls[hidden],#landlineResults[hidden]{display:none!important;}',
      '.landline-field-label{display:block;color:#fff;font-weight:700;margin:2px 0 4px;}',
      '.landline-extras-panel{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.24);border-radius:10px;padding:10px;text-align:left;}',
      '.landline-extras-header{display:flex;align-items:center;justify-content:space-between;color:#fff;font-weight:700;margin-bottom:8px;}',
      '#landlineExtrasSummary{font-size:12px;font-weight:600;opacity:.8;}',
      '#landlineExtras{display:none;}',
      '.landline-extras-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;max-height:190px;overflow:auto;padding-right:4px;}',
      '.landline-extra-option{display:flex;align-items:flex-start;gap:8px;color:#fff;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:8px 10px;font-size:14px;line-height:1.35;cursor:pointer;}',
      '.landline-extra-option input{margin-top:2px;flex:0 0 auto;}',
      '#landlineResults{margin:12px 0;padding:14px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(255,255,255,.08);color:#fff;}',
      '.landline-results-title{font-weight:800;margin-bottom:10px;}',
      '.landline-breakdown-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}',
      '.landline-breakdown-item{display:flex;justify-content:space-between;gap:10px;align-items:center;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:10px;}',
      '.landline-breakdown-label{font-weight:700;opacity:.86;}',
      '.landline-breakdown-value{font-weight:800;white-space:nowrap;}',
      '.landline-hidden-input{display:none;}'
    ].join('');
    document.head.appendChild(style);
  }
  function installUi() {
    var container = byId('divv');
    var products = byId('products');
    var balance = byId('balance');
    if (!container || !products || !balance || byId('calculatorServiceType')) return;

    tagInternetGroups();
    installLandlineStyles();

    var modeWrap = document.createElement('div');
    modeWrap.className = 'calculator-service-type';
    modeWrap.setAttribute('data-calculator-shared', 'service-type');
    modeWrap.innerHTML = '<label for="calculatorServiceType">Service Type</label><select id="calculatorServiceType" class="selectt"><option value="internet">Internet</option><option value="landline">Landline</option></select>';
    container.insertBefore(modeWrap, products);

    var landlineControls = document.createElement('div');
    landlineControls.id = 'landlineControls';
    landlineControls.hidden = true;
    landlineControls.setAttribute('data-calculator-group', 'landline');
    landlineControls.innerHTML = [
      '<label class="landline-field-label" for="landlineCategory">Customer Type</label><select id="landlineCategory" class="selectt"><option value="residential">Residential</option><option value="business">Business</option></select>',
      '<label class="landline-field-label" for="landlinePackage">Base Package</label><select id="landlinePackage" class="selectt"></select>',
      '<div id="landlinePeriodWrap"><label class="landline-field-label" for="landlinePeriod">Billing Period</label><select id="landlinePeriod" class="selectt"></select></div>',
      '<div class="landline-extras-panel"><div class="landline-extras-header"><label for="landlineExtras">Extras</label><span id="landlineExtrasSummary">No extras selected</span></div><div id="landlineExtrasList" class="landline-extras-list" role="group" aria-label="Landline extras"></div><select id="landlineExtras" class="selectt" multiple size="6" aria-hidden="true" tabindex="-1"></select></div>'
    ].join('');
    products.parentNode.insertBefore(landlineControls, products.nextSibling);

    var landlineResults = document.createElement('div');
    landlineResults.id = 'landlineResults';
    landlineResults.hidden = true;
    landlineResults.setAttribute('data-calculator-group', 'landline');
    landlineResults.innerHTML = [
      '<div class="landline-results-title">Landline Breakdown</div>',
      '<div class="landline-breakdown-grid">',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">Base Package</span><span class="landline-breakdown-value" id="landlineBaseAmountDisplay">0.00</span></div>',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">Extras</span><span class="landline-breakdown-value" id="landlineExtrasAmountDisplay">0.00</span></div>',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">CPE</span><span class="landline-breakdown-value" id="landlineCpeAmountDisplay">0.00</span></div>',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">Current Balance</span><span class="landline-breakdown-value" id="landlineBalanceDeductionDisplay">0.00</span></div>',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">Tax</span><span class="landline-breakdown-value" id="landlineTaxAmountDisplay">0.00</span></div>',
      '<div class="landline-breakdown-item"><span class="landline-breakdown-label">Final Amount</span><span class="landline-breakdown-value" id="landlineFinalAmountDisplay">0.00</span></div>',
      '</div>',
      '<input class="landline-hidden-input" type="text" id="landlineBaseAmount" readonly value="0.00">',
      '<input class="landline-hidden-input" type="text" id="landlineExtrasAmount" readonly value="0.00">',
      '<input class="landline-hidden-input" type="text" id="landlineCpeAmount" readonly value="0.00">',
      '<input class="landline-hidden-input" type="text" id="landlineBalanceDeduction" readonly value="0.00">',
      '<input class="landline-hidden-input" type="text" id="landlineTaxAmount" readonly value="0.00">',
      '<input class="landline-hidden-input" type="text" id="landlineFinalAmount" readonly value="0.00">'
    ].join('');
    balance.parentNode.insertBefore(landlineResults, balance.nextSibling);

    byId('calculatorServiceType').addEventListener('change', applyMode);
    byId('landlineCategory').addEventListener('change', populatePackages);
    byId('landlinePackage').addEventListener('change', populatePeriods);
    byId('landlinePeriod').addEventListener('change', namespace.router.dispatch);
    byId('landlineExtras').addEventListener('change', namespace.router.dispatch);
    byId('landlineExtrasList').addEventListener('change', syncExtrasFromCheckboxes);
    balance.addEventListener('input', function () { if (getMode() === 'landline') namespace.router.dispatch(); });
    bindRoutingEvents();
    populatePackages();
    applyMode();
  }

  namespace.internet.calculate = runInternetCalculate;
  namespace.landline.calculate = calculateLandlineFromDom;
  namespace.router.getMode = getMode;
  namespace.router.dispatch = function () {
    if (getMode() === 'landline') return namespace.landline.calculate();
    return namespace.internet.calculate();
  };
  namespace.router.applyMode = applyMode;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi);
  else installUi();
})(window, document);
