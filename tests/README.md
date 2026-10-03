# Testler

Bu testler `jsdom` ile uygulamayi bir sanal tarayicida acar, kumanda tuslarini
gonderir ve sonuclari dogrular. Gercek TV gerekmez.

## Calistirma

```cmd
cd tests
npm init -y
npm install jsdom
node unit.test.js     REM 40 kontrol - parser, URL uretimi, sanal liste, hatalar
node nav.test.js      REM 21 kontrol - kumanda yon tusu navigasyonu (gercek olculerle)
node e2e.test.js      REM 52 kontrol - sahte Xtream sunucusuyla tum ekranlarin gezilmesi
```

## ONEMLI: .wgt paketine dahil etmeyin

Bu klasor televizyona gonderilecek pakete girmemelidir:

```cmd
tizen build-web -e tests -e node_modules -e "*.md" -- .
```

Tizen Studio arayuzunde: projeye sag tik -> Properties -> Resource Filters ->
`tests` klasorunu haric tutun.
