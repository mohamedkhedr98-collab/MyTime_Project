(function (window) {
  'use strict';

  var namespace = window.SRCalculator = window.SRCalculator || {};

  function toSafeNumber(value) {
    var numberValue = parseFloat(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  function clampMoney(value) {
    var numberValue = toSafeNumber(value);
    return numberValue > 0 ? numberValue : 0;
  }

  function roundMoney(value) {
    return Math.round((toSafeNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(value) {
    return roundMoney(value).toFixed(2);
  }

  function getSelectedCpeAmount(documentRef) {
    var documentObject = documentRef || window.document;
    var cpeMap = {
      service1: 5,
      service2: 10,
      service3: 20,
      service4: 50
    };
    return Object.keys(cpeMap).reduce(function (total, id) {
      var button = documentObject.getElementById(id);
      return button && button.classList && button.classList.contains('active') ? total + cpeMap[id] : total;
    }, 0);
  }

  namespace.core = {
    toSafeNumber: toSafeNumber,
    clampMoney: clampMoney,
    roundMoney: roundMoney,
    formatMoney: formatMoney,
    getSelectedCpeAmount: getSelectedCpeAmount
  };
})(window);
