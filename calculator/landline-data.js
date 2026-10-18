(function (window) {
  'use strict';

  var namespace = window.SRCalculator = window.SRCalculator || {};

  namespace.landlinePackages = {
    residential: [
      { name: 'WE Ardy 40', periods: { monthly: 40, quarterly: 120, yearly: 480 }, tax: 14 },
      { name: 'WE Ardy 50', periods: { monthly: 50, quarterly: 150, yearly: 600 }, tax: 14 },
      { name: 'WE Ardy 80', periods: { monthly: 80, quarterly: 240, yearly: 960 }, tax: 14 },
      { name: 'Kalamy 40', periods: { monthly: 40, quarterly: 120 }, tax: 14 },
      { name: 'Marhaba Annual', periods: { yearly: 300 }, tax: 14 },
      { name: 'WE Telephonet 90', periods: { monthly: 90 }, tax: 14 },
      { name: 'WE Telephonet 145', periods: { monthly: 145 }, tax: 14 },
      { name: 'WE Telephonet 230', periods: { monthly: 230 }, tax: 14 }
    ],
    business: [
      { name: 'WE Ardy 60 Business', periods: { monthly: 60, quarterly: 180, yearly: 720 }, tax: 14 },
      { name: 'WE Ardy 65 Business', periods: { monthly: 65, quarterly: 195, yearly: 780 }, tax: 14 },
      {
        name: 'WE Ardy 90 Business',
        taxMode: 'fixedFinal',
        periods: {
          monthly: { base: 90, final: 105.80 },
          quarterly: { base: 270, final: 317.38 }
        }
      }
    ]
  };

  namespace.landlineExtras = [
    { name: 'Ardy Extra 10', price: 10, tax: 14 },
    { name: 'Ardy Extra 20', price: 20, tax: 14 },
    { name: 'WE Mobile Extra 5', price: 5, tax: 23.12 },
    { name: 'Mobile Extra 15', price: 15, tax: 23.12 },
    { name: 'Mobile Extra 25', price: 25, tax: 23.12 }
  ];

  namespace.commercialExtras = [
    { name: 'Extra 100', price: 100, tax: 23.12, freeMinutes: 400 },
    { name: 'Extra 300', price: 300, tax: 23.12, freeMinutes: 1300 },
    { name: 'Extra 600', price: 600, tax: 23.12, freeMinutes: 3000 },
    { name: 'Extra 1000', price: 1000, tax: 23.12, freeMinutes: 6600 },
    { name: 'Mobasher 35', price: 35, tax: 14, freeMinutes: 350 },
    { name: 'Mobasher 170', price: 170, tax: 14, freeMinutes: 1700 }
  ];
})(window);
