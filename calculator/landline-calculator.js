(function (window) {
  'use strict';

  var namespace = window.SRCalculator = window.SRCalculator || {};
  var core = namespace.core;

  function findPackage(category, packageName) {
    var packages = namespace.landlinePackages && namespace.landlinePackages[category];
    if (!Array.isArray(packages) || !packageName) return null;
    return packages.find(function (item) { return item && item.name === packageName; }) || null;
  }

  function getPeriodValue(packageConfig, period) {
    if (!packageConfig || !packageConfig.periods || !period || packageConfig.periods[period] == null) return null;
    var selected = packageConfig.periods[period];
    if (selected && typeof selected === 'object') return selected;
    return { base: core.toSafeNumber(selected), final: null };
  }

  function applyBalance(items, balance) {
    var remainingBalance = core.clampMoney(balance);
    return items.map(function (item) {
      var amount = core.clampMoney(item.amount);
      var deduction = Math.min(amount, remainingBalance);
      remainingBalance = core.clampMoney(remainingBalance - deduction);
      return {
        amount: core.clampMoney(amount - deduction),
        originalAmount: amount,
        taxRate: core.toSafeNumber(item.taxRate),
        fixedFinal: item.fixedFinal,
        name: item.name
      };
    });
  }

  function calculateLandline(input) {
    input = input || {};
    var category = input.category === 'business' ? 'business' : 'residential';
    var packageConfig = findPackage(category, input.packageName);
    var periodValue = getPeriodValue(packageConfig, input.period);
    var balance = core.clampMoney(input.balance);
    var cpeAmount = core.clampMoney(input.cpeAmount);
    var selectedExtras = Array.isArray(input.extras) ? input.extras : [];

    var baseAmount = packageConfig && periodValue ? core.clampMoney(periodValue.base) : 0;
    var extrasAmount = selectedExtras.reduce(function (total, extra) {
      return total + core.clampMoney(extra && extra.price);
    }, 0);
    var subtotal = baseAmount + extrasAmount + cpeAmount;
    var balanceDeduction = Math.min(subtotal, balance);

    var taxableItems = [];
    if (packageConfig && periodValue) {
      taxableItems.push({ amount: baseAmount, taxRate: packageConfig.tax || 0, fixedFinal: periodValue.final, name: packageConfig.name });
    }
    selectedExtras.forEach(function (extra) {
      if (!extra) return;
      taxableItems.push({ amount: extra.price, taxRate: extra.tax || 0, name: extra.name });
    });
    if (cpeAmount > 0) taxableItems.push({ amount: cpeAmount, taxRate: 14, name: 'Router Fees' });

    var balancedItems = applyBalance(taxableItems, balanceDeduction);
    var taxableAmount = balancedItems.reduce(function (total, item) { return total + item.amount; }, 0);
    var finalAmount = balancedItems.reduce(function (total, item) {
      if (Number.isFinite(item.fixedFinal) && item.originalAmount > 0) {
        // Business rule for fixed-final periods (WE Ardy 90 Business):
        // the configured final price is authoritative when no balance is used.
        // If balance is applied before tax, reduce that fixed final price in
        // the same deterministic proportion as the remaining taxable base.
        // Example: monthly base 90/final 105.80 with 45 balance => 45/90
        // of the fixed final remains due, so final contribution is 52.90.
        return total + (item.amount / item.originalAmount) * item.fixedFinal;
      }
      return total + item.amount * (1 + core.toSafeNumber(item.taxRate) / 100);
    }, 0);
    var taxAmount = core.clampMoney(finalAmount - taxableAmount);

    return {
      baseAmount: core.roundMoney(baseAmount),
      extrasAmount: core.roundMoney(extrasAmount),
      cpeAmount: core.roundMoney(cpeAmount),
      balanceDeduction: core.roundMoney(balanceDeduction),
      taxableAmount: core.roundMoney(taxableAmount),
      taxAmount: core.roundMoney(taxAmount),
      finalAmount: core.roundMoney(finalAmount)
    };
  }

  namespace.calculateLandline = calculateLandline;
})(window);
