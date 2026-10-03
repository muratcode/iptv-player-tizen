/* ============================================================
   js/ui/virtualList.js
   SANAL LISTE / IZGARA  --  performansin kalbi

   PROBLEM: 8.000 kanalli bir playlist icin 8.000 DOM ogesi
   olusturmak Samsung TV'yi 10+ saniye kilitler ve bellegi doldurur.

   COZUM: Yalnizca EKRANDA GORUNEN satirlar kadar (+ tampon) DOM
   ogesi olusturulur (tipik olarak 12-18 adet) ve kaydirma sirasinda
   bu ogeler YENIDEN KULLANILIR (recycling). Liste 50 kanal da olsa
   50.000 kanal da olsa DOM'daki oge sayisi sabittir.

   Kaydirma icin scrollTop yerine CSS transform: translateY()
   kullanilir -> TV'nin GPU'su tarafindan hizlandirilir, yeniden
   layout (reflow) tetiklemez.

   KULLANIM:
     var list = App.UI.VirtualList.create({
        container: el, itemHeight: 72, columns: 1,
        render: function(node, item, index){...},
        onSelect: function(item, index){...}
     });
     list.setItems(channels);

   Odak yonetimi: container ogesi [data-focusable]'dir ve
   container.__vlist = list atanir. app.js odakli ogede __vlist
   gorunce yon tuslarini once bu listeye gonderir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    App.UI = App.UI || {};

    function create(opts) {
        var o = Object.assign({
            container: null,
            itemHeight: 72,
            columns: 1,
            gapX: 12,
            gapY: 12,
            buffer: 2,
            itemClass: 'list__item',
            create: null,        /* function(node) - iskeleti bir kez kurar */
            update: null,        /* function(node, item, index) - sadece gunceller */
            emptyText: 'Liste bos',
            emptyIcon: '📭',
            render: function () { },
            onSelect: null,
            onFocusChange: null,
            onEdge: null,        /* function(dir) -> true ise kenar hareketi tuketildi */
            wrap: false,         /* listenin basi/sonu birbirine baglansin mi */
            /* Kaydirma bicimi:
                 'edge'   : odak kenara gelince kayar (+1 satir on izleme).
                            Kisa satirli listeler icin (kanal, kategori).
                 'anchor' : odakli satir DAIMA ayni yerde (ustte) durur,
                            icerik onun altinda kayar. Uzun satirli afis
                            izgaralari icin: odak asagi-yukari ziplamaz.
               Verilmezse izgara (columns>1) 'anchor', liste 'edge' olur. */
            scrollMode: null
        }, opts || {});
        if (!o.scrollMode) { o.scrollMode = o.columns > 1 ? 'anchor' : 'edge'; }

        var host = o.container;
        if (!host) { throw new Error('VirtualList: container zorunlu'); }

        var items = [];
        var index = 0;
        var active = false;          /* Nav odagi bu listede mi */
        var scrollTop = 0;           /* px */
        var pool = [];               /* {node, dataIndex} */
        var viewport, canvas, emptyBox;
        var rowH = o.itemHeight + (o.columns > 1 ? o.gapY : 0);
        var destroyed = false;

        /* ---------- Iskelet ---------- */
        U.empty(host);
        host.classList.add('list');
        viewport = U.el('div', 'list__viewport');
        canvas = U.el('div', 'list__canvas');
        viewport.appendChild(canvas);
        host.appendChild(viewport);

        function viewH() { return viewport.clientHeight || 1; }
        function rowCount() { return o.columns > 1 ? Math.ceil(items.length / o.columns) : items.length; }
        function visibleRows() { return Math.ceil(viewH() / rowH) + 1; }
        function poolSize() { return (visibleRows() + o.buffer * 2) * o.columns; }
        function maxScroll() { return Math.max(0, rowCount() * rowH - viewH()); }

        /* ---------- Havuz yonetimi ---------- */
        function ensurePool() {
            var want = poolSize();
            while (pool.length < want) {
                var node = U.el('div', o.itemClass);
                node.style.height = o.itemHeight + 'px';
                node.style.display = 'none';
                canvas.appendChild(node);
                pool.push({ node: node, dataIndex: -1 });
            }
            /* Fazlaligi sil (ekran boyutu degisirse) */
            while (pool.length > want + o.columns) {
                var extra = pool.pop();
                if (extra.node.parentNode) { extra.node.parentNode.removeChild(extra.node); }
            }
        }

        function colWidth() {
            var w = viewport.clientWidth;
            return (w - o.gapX * (o.columns - 1)) / o.columns;
        }

        /* ---------- Cizim ---------- */
        function paint() {
            if (destroyed) { return; }
            if (!items.length) { return; }

            ensurePool();

            var firstRow = Math.max(0, Math.floor(scrollTop / rowH) - o.buffer);
            var lastRow = Math.min(rowCount() - 1, firstRow + visibleRows() + o.buffer * 2 - 1);
            var start = firstRow * o.columns;
            var end = Math.min(items.length - 1, (lastRow + 1) * o.columns - 1);

            var cw = o.columns > 1 ? colWidth() : 0;
            var p = 0;

            for (var i = start; i <= end; i++) {
                var slot = pool[p++];
                if (!slot) { break; }
                var node = slot.node;
                var row = o.columns > 1 ? Math.floor(i / o.columns) : i;
                var col = o.columns > 1 ? (i % o.columns) : 0;

                node.style.display = '';
                node.style.top = (row * rowH) + 'px';
                if (o.columns > 1) {
                    node.style.left = (col * (cw + o.gapX)) + 'px';
                    node.style.width = cw + 'px';
                    node.style.right = 'auto';
                }

                /* Ayni veri zaten cizilmisse tekrar render etme (CPU tasarrufu) */
                if (slot.dataIndex !== i || node.__needsRender) {
                    slot.dataIndex = i;
                    node.__needsRender = false;
                    node.__item = items[i];
                    node.__index = i;
                    try {
                        /* ISKELET DESENI (performans):
                           o.create(node) satirin DOM iskeletini BIR KEZ kurar,
                           o.update(node, item, i) yalnizca metin/gorsel gunceller.
                           Boylece her kaydirma adiminda oge yaratma/silme yapilmaz.
                           o.render verilirse eski (her seferinde yeniden kuran)
                           davranis surer. */
                        if (o.create) {
                            if (!node.__built) { o.create(node); node.__built = true; }
                            o.update(node, items[i], i);
                        } else {
                            o.render(node, items[i], i);
                        }
                    } catch (e) {
                        App.Logger.get('VList').error('render', e && e.message);
                    }
                }

                U.toggleClass(node, 'is-focused', active && i === index);
                U.toggleClass(node, 'is-current', !active && i === index);
            }

            /* Kullanilmayan havuz ogelerini gizle */
            for (; p < pool.length; p++) {
                pool[p].node.style.display = 'none';
                pool[p].dataIndex = -1;
            }

            canvas.style.height = (rowCount() * rowH) + 'px';
            canvas.style.WebkitTransform = 'translateY(' + (-scrollTop) + 'px)';
            canvas.style.transform = 'translateY(' + (-scrollTop) + 'px)';
        }

        /**
         * Odakli satiri gorunur tut.
         *
         * ONCEKI HATA: on izleme payi her zaman TAM BIR SATIR idi. Afis
         * izgarasinda satir ~470 px, gorunur alan ~770 px; "satir + bir
         * satir pay" ekrana sigmadigi icin odakli satir ustten kesiliyor,
         * bir sonraki basista liste GERI kayiyordu (secili oge asagi
         * yukari zipliyordu). Artik pay, gorunur alana sigacak kadarla
         * sinirli; izgaralarda ise odakli satir sabit yerde tutulur.
         *
         * @param {number} i
         * @param {boolean} [center] sayfa atlamasi: odakli satiri ortala
         */
        function scrollToIndex(i, center) {
            var row = o.columns > 1 ? Math.floor(i / o.columns) : i;
            var top = row * rowH;
            var vh = viewH();

            if (center && o.scrollMode !== 'anchor') {
                scrollTop = U.clamp(Math.round(top - (vh - rowH) / 2), 0, maxScroll());
                return;
            }

            if (o.scrollMode === 'anchor') {
                /* Odakli satir ustte; sona yaklasinca son satirlar yerinde
                   kalir ve odak asagi iner (bos alan gosterilmez). */
                scrollTop = U.clamp(top, 0, maxScroll());
                return;
            }

            /* 'edge': odakli satir + mumkunse bir satirlik on izleme.
               Pay, odakli satirin tamami gorunur kalacak sekilde sinirlanir. */
            var pad = Math.max(0, Math.min(rowH, Math.floor((vh - rowH) / 2)));
            var bottom = top + o.itemHeight;
            var s;
            /* Kaydirma satir sinirina oturtulur: ustteki satir yarim
               kesik gorunmez (yarim satir yalnizca altta, "devami var"
               ipucu olarak kalir). Odakli satiri kesecekse oturtulmaz. */
            if (top - pad < scrollTop) {
                s = Math.floor((top - pad) / rowH) * rowH;
                if (s + vh < bottom) { s = top - pad; }
                scrollTop = Math.max(0, s);
            } else if (bottom + pad > scrollTop + vh) {
                s = Math.ceil((bottom + pad - vh) / rowH) * rowH;
                if (s > top) { s = bottom + pad - vh; }
                scrollTop = Math.min(maxScroll(), s);
            }
        }

        function showEmpty(show, text, icon) {
            if (show) {
                if (!emptyBox) {
                    emptyBox = U.el('div', 'empty');
                    emptyBox.appendChild(U.el('div', 'empty__icon', icon || o.emptyIcon));
                    emptyBox.appendChild(U.el('div', 'empty__title', text || o.emptyText));
                    host.appendChild(emptyBox);
                } else {
                    emptyBox.childNodes[0].textContent = icon || o.emptyIcon;
                    emptyBox.childNodes[1].textContent = text || o.emptyText;
                    emptyBox.classList.remove('hidden');
                }
                viewport.classList.add('hidden');
            } else {
                if (emptyBox) { emptyBox.classList.add('hidden'); }
                viewport.classList.remove('hidden');
            }
        }

        function setIndex(i, opts2) {
            opts2 = opts2 || {};
            if (!items.length) { return; }
            var old = index;
            index = U.clamp(i, 0, items.length - 1);
            scrollToIndex(index, opts2.jump);
            paint();
            if (old !== index && o.onFocusChange && !opts2.silent) {
                o.onFocusChange(items[index], index);
            }
        }

        function moveBy(delta, jump) {
            if (!items.length) { return false; }
            var next = index + delta;

            if (next < 0) {
                if (o.wrap) { next = items.length - 1; }
                else { return false; }
            } else if (next > items.length - 1) {
                if (o.wrap) { next = 0; }
                else if (delta > 1) { next = items.length - 1; }   /* sayfa atlamasi sona yapissin */
                else { return false; }
            }
            setIndex(next, { jump: jump });
            return true;
        }

        var api = {
            /* ---------- Veri ---------- */
            /**
             * @param {Array} arr
             * @param {object} [opts2] {index, silent, emptyText, emptyIcon,
             *        keepScroll: true ise kaydirma konumu KORUNUR. Ayarlar gibi
             *        bir satiri degistirip listeyi tazeleyen ekranlarda onceden
             *        liste her seferinde odakli satiri ortalayacak sekilde
             *        zipliyordu.}
             */
            setItems: function (arr, opts2) {
                opts2 = opts2 || {};
                items = arr || [];
                /* Havuzu gecersiz kil ki tum satirlar yeniden cizilsin */
                for (var i = 0; i < pool.length; i++) { pool[i].dataIndex = -1; }
                index = U.clamp(opts2.index || 0, 0, Math.max(0, items.length - 1));
                if (opts2.keepScroll) {
                    scrollTop = U.clamp(scrollTop, 0, maxScroll());
                } else {
                    scrollTop = 0;
                }
                if (items.length) {
                    showEmpty(false);
                    scrollToIndex(index, !opts2.keepScroll && index > 0);
                    paint();
                    if (o.onFocusChange && !opts2.silent) { o.onFocusChange(items[index], index); }
                } else {
                    showEmpty(true, opts2.emptyText, opts2.emptyIcon);
                    canvas.style.height = '0px';
                }
                return api;
            },

            getItems: function () { return items; },
            count: function () { return items.length; },
            getIndex: function () { return index; },
            getItem: function () { return items[index]; },
            itemAt: function (i) { return items[i]; },

            setIndex: setIndex,
            moveBy: moveBy,

            /** Tek bir satiri yeniden cizdir (ornek: favori yildizi degisti) */
            refreshIndex: function (i) {
                for (var p = 0; p < pool.length; p++) {
                    if (pool[p].dataIndex === i) {
                        pool[p].node.__needsRender = true;
                        pool[p].dataIndex = -1;
                    }
                }
                paint();
            },

            refresh: function () {
                for (var p = 0; p < pool.length; p++) { pool[p].dataIndex = -1; }
                paint();
            },

            /** Ekran yeniden boyutlandiginda / view acildiginda */
            relayout: function () {
                rowH = o.itemHeight + (o.columns > 1 ? o.gapY : 0);
                ensurePool();
                scrollTop = U.clamp(scrollTop, 0, maxScroll());
                scrollToIndex(index);
                api.refresh();
            },

            /** Belirli bir ogeye atla (predicate ile) */
            jumpTo: function (predicate) {
                for (var i = 0; i < items.length; i++) {
                    if (predicate(items[i], i)) { setIndex(i, { jump: true }); return i; }
                }
                return -1;
            },

            /* ---------- Odak ---------- */
            setActive: function (on) {
                active = !!on;
                paint();
            },
            isActive: function () { return active; },

            /* ---------- Tus isleme ---------- */
            /** @returns {boolean} tus tuketildi mi */
            onKey: function (code) {
                var cols = o.columns;

                /* BOS LISTE: Onceden 'false' donuluyordu; bu durumda tuslar
                   genel spatial-nav'a dusuyor ve odak bambaska bir kolona
                   kaciyordu ("kategori icinde secim sikintisi"). Artik
                   yukari/asagi yutulur, sag/sol ise kolon degistirmek icin
                   onEdge'e verilir. */
                if (!items.length) {
                    if (code === KEY.UP || code === KEY.DOWN ||
                        code === KEY.CH_UP || code === KEY.CH_DOWN || code === KEY.ENTER) {
                        return true;
                    }
                    if (code === KEY.LEFT)  { return o.onEdge ? o.onEdge('left') === true : false; }
                    if (code === KEY.RIGHT) { return o.onEdge ? o.onEdge('right') === true : false; }
                    return false;
                }

                switch (code) {
                    case KEY.UP:
                        if (moveBy(-cols)) { return true; }
                        return o.onEdge ? o.onEdge('up') === true : false;

                    case KEY.DOWN:
                        if (moveBy(cols)) { return true; }
                        return o.onEdge ? o.onEdge('down') === true : false;

                    case KEY.LEFT:
                        if (cols > 1 && (index % cols) !== 0) { moveBy(-1); return true; }
                        return o.onEdge ? o.onEdge('left') === true : false;

                    case KEY.RIGHT:
                        if (cols > 1 && (index % cols) !== cols - 1 && index < items.length - 1) {
                            moveBy(1); return true;
                        }
                        return o.onEdge ? o.onEdge('right') === true : false;

                    /* Kanal +/- : sayfa atlama */
                    case KEY.CH_UP:
                        moveBy(-visibleRows() * cols, true); return true;
                    case KEY.CH_DOWN:
                        moveBy(visibleRows() * cols, true); return true;

                    case KEY.ENTER:
                        if (o.onSelect) { o.onSelect(items[index], index); }
                        return true;

                    default:
                        return false;
                }
            },

            select: function () {
                if (items.length && o.onSelect) { o.onSelect(items[index], index); }
            },

            destroy: function () {
                destroyed = true;
                items = [];
                pool = [];
                U.empty(host);
                host.__vlist = null;
            },

            _paint: paint
        };

        host.__vlist = api;
        ensurePool();
        return api;
    }

    /**
     * Afis izgarasi olculeri.
     * Oge yuksekligi, kapsayicinin gorunur alanina TAM `rows` satir
     * sigacak sekilde; sutun sayisi ise afis gorseli ~2:3 oraninda
     * kalacak sekilde hesaplanir. Onceden sabit 5 sutun vardi ve ekrana
     * ancak 1.6 satir sigiyordu: odakli satir hep yarim gorunuyordu.
     *
     * @param {HTMLElement} host  izgara kapsayicisi (gorunur olmali)
     * @param {object} [opts] {rows: 2}
     * @returns {{columns, itemHeight, gapX, gapY}}
     */
    function posterGrid(host, opts) {
        opts = opts || {};
        var rows = opts.rows || 2;
        var gapX = U.rem(1.25);
        var gapY = U.rem(1.25);
        var capH = U.rem(3.5);                     /* .poster__cap yuksekligi */
        var w = host.clientWidth || 1;
        var h = host.clientHeight || 1;

        /* rows*itemH + (rows-1)*gapY = h  ->  son satir alt kenara tam oturur */
        var itemH = Math.floor((h - gapY * (rows - 1)) / rows);
        var imgH = Math.max(1, itemH - capH);
        var cols = Math.round((w + gapX) / (imgH / 1.5 + gapX));
        cols = U.clamp(cols, 4, 8);

        return { columns: cols, itemHeight: itemH, gapX: gapX, gapY: gapY };
    }

    App.UI.VirtualList = { create: create, posterGrid: posterGrid };
})(window.App = window.App || {});
