// Shops and homes all over the city. Every big district gets places to walk into: boutiques with their own
// lines of clothes, cafés with their own menus, 24/7 stores, and homes to buy: blocks of cheap flats
// (one door, many flats behind it), flats, houses and a mansion with doors of their own.
// Each one is a door with a bright storefront (entrances.js) leading into one of the shared rooms built in
// places.js; this file says which building, what it's called, what it sells and what it costs.
//
// Homes: a price to buy, then rent every real day (24 hours of real time, the same for every player once the
// game is online). The rent is taken from your cash by itself; with no cash for it the door stays locked
// until the debt is paid, and after 14 unpaid days the home goes back on sale and half its price comes back.
// Inside: a bed (sleep, save, and you'll wake up here next time), a wardrobe, and a desk for rent and sale.
(function (NB) {
  'use strict';
  const DAY = 24 * 3600 * 1000, GRACE_DAYS = 14;
  const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');

  /* ---------- what the shops sell ---------- */
  const heal = (n, msg) => G => {
    const P = G.player;
    return { desc: '+' + n + ' здоровья', disabled: P.hp >= 100 ? 'Вы сыты' : '', buy: () => { P.hp = Math.min(100, P.hp + n); return msg; } };
  };
  const drink = (s, msg) => G => ({ desc: 'Слегка кружит голову', buy: () => { if (G.drunk) G.drunk(s); return msg; } });
  const MENUS = {
    burger: [['Бургер «Портовый»', 14, heal(40, 'Сочный!')], ['Двойной чизбургер', 24, heal(65, 'Вот это порция!')], ['Картошка фри', 6, heal(15, 'Хрустит!')], ['Кола со льдом', 4, heal(10, 'Освежает')]],
    taco: [['Тако с говядиной', 8, heal(25, '¡Muy bien!')], ['Буррито XXL', 16, heal(55, 'Еле доели')], ['Начос с сыром', 9, heal(25, 'Остро!')], ['Орчата', 5, heal(10, 'Сладко и холодно')]],
    shawarma: [['Шаурма классика', 9, heal(35, 'Лучшая на районе')], ['Шаурма двойная', 15, heal(60, 'Сытно!')], ['Шашлык на шпажке', 12, heal(40, 'С дымком')], ['Айран', 3, heal(10, 'Освежает')]],
    pizza: [['Кусок пиццы', 6, heal(25, 'Горячая!')], ['Пицца «Пепперони» целиком', 30, heal(100, 'Съели всю. Неплохо!')], ['Кальцоне', 14, heal(45, 'С сыром внутри')], ['Лимонад', 4, heal(10, 'Шипит')]],
    sushi: [['Ролл «Калифорния»', 28, heal(35, 'Свежайший')], ['Сет «Пойнт 21»', 90, heal(100, 'Королевский ужин')], ['Мисо-суп', 12, heal(20, 'Согревает')], ['Саке', 25, drink(20, 'Кампай!')]],
    coco: [['Кокос с трубочкой', 10, heal(20, 'Прямо с пальмы')], ['Фруктовый смузи', 14, heal(30, 'Манго и маракуйя')], ['Пина колада', 22, drink(20, 'Отпуск начался')], ['Креветки на гриле', 35, heal(55, 'Пахнет морем')]],
    lobster: [['Омар на гриле', 180, heal(100, 'Изысканно')], ['Устрицы, дюжина', 120, heal(60, 'Свежие, с лимоном')], ['Стейк из тунца', 90, heal(70, 'Шеф доволен')], ['Шампанское', 150, drink(25, 'Пузырьки в голову')]],
    donut: [['Пончик с глазурью', 4, heal(12, 'Розовая глазурь!')], ['Коробка пончиков', 18, heal(50, 'Дюжина — и все ваши')], ['Капучино', 6, heal(12, 'Бодрит')], ['Молочный коктейль', 8, heal(20, 'Ванильный')]],
    bbq: [['Рёбрышки BBQ', 26, heal(60, 'Пальчики оближешь')], ['Хот-дог с луком', 7, heal(20, 'Классика')], ['Кукуруза на гриле', 5, heal(12, 'С маслом')], ['Холодное пиво', 6, drink(15, 'Ледяное!')]],
    cafe: [['Круассан', 6, heal(15, 'Хрустящий')], ['Сэндвич с индейкой', 12, heal(35, 'Свежий')], ['Латте', 7, heal(12, 'С сердечком на пенке')], ['Чизкейк', 9, heal(25, 'Нью-йоркский')]],
    market: [['Чипсы', 3, heal(8, 'Хрум')], ['Сэндвич в упаковке', 6, heal(20, 'Сойдёт')], ['Энергетик NEPLOXO', 5, heal(15, 'Заряд бодрости')], ['Пиво, банка', 4, drink(12, 'Пшшш!')],
      ['Аптечка', 150, G => ({ desc: 'Полное здоровье', disabled: G.player.hp >= 100 ? 'Вы здоровы' : '', buy: () => { G.player.hp = 100; return 'Как новенький'; } })],
      ['Лотерейный билет «Неплохо»', 20, G => ({ desc: 'Сотрите и узнайте: до $5 000', buy: () => {
        const r = Math.random();
        if (r < .005) { G.money.add(5000, 'Лотерея'); return 'ДЖЕКПОТ! +$5 000!'; }
        if (r < .05) { G.money.add(500, 'Лотерея'); return 'Выигрыш $500!'; }
        if (r < .2) { G.money.add(40, 'Лотерея'); return 'Выигрыш $40'; }
        return 'Пусто. Повезёт в следующий раз';
      } })]]
  };
  // the lines of clothes: which pieces each boutique carries
  const STOCK = {
    street: { top: ['tank', 'tank_black', 'mesh', 'tee_white', 'tee_black', 'tee_pink', 'tee_cyan', 'tee_neon', 'tee_21', 'tee_leha', 'jersey', 'hoodie', 'bomber', 'camo', 'varsity'], pants: ['darkjeans', 'track', 'camo', 'grey', 'olive', 'orange'], shoes: ['white', 'black', 'red', 'cyan'], hat: ['cap_red', 'cap_black', 'cap_neon', 'bandana', 'beanie', 'bucket'], glasses: ['shutter', 'star', 'nerd'] },
    beach: { top: ['hawaii', 'palms', 'flamingo', 'tank', 'linen', 'tiger', 'miami', 'tee_white', 'tee_cyan'], pants: ['sh_denim', 'sh_white', 'sh_khaki', 'sh_board', 'sh_hawaii', 'white', 'beige'], shoes: ['flip', 'white', 'cyan'], hat: ['panama', 'bucket', 'cap_neon'], glasses: ['aviator', 'round', 'big', 'star'] },
    harbor: { top: ['mechanic', 'denim', 'leather', 'bomber', 'camo', 'hoodie', 'tank_black', 'tommy'], pants: ['jeans', 'darkjeans', 'olive', 'navy', 'leather'], shoes: ['brown', 'black', 'white'], hat: ['beanie', 'cowboy', 'cap_black', 'bandana'], glasses: ['aviator', 'shutter'] },
    mall: { top: ['tommy', 'denim', 'golf', 'leather', 'neon', 'linen', 'hoodie', 'varsity', 'turtleneck', 'zebra', 'leopard', 'tee_notbad'], pants: ['navy', 'grey', 'red', 'pink', 'plaid', 'white', 'beige'], shoes: ['black', 'brown', 'red', 'cyan', 'whiteleather'], hat: ['cap_notbad', 'panama', 'fedora', 'bucket'], glasses: ['round', 'aviator', 'big'] },
    luxe: { top: ['silk', 'turtleneck', 'tuxedo', 'redsuit', 'gold', 'snake', 'croc', 'diamond', 'leopard', 'miami'], pants: ['leather', 'gold', 'white', 'plaid', 'black'], shoes: ['whiteleather', 'croc', 'gold'], hat: ['fedora', 'tophat', 'crown'], glasses: true, chain: true, watch: true }
  };

  /* ---------- where they are ----------
     b: the building's footprint [x0, z0, x1, z1]; face: the side the door is on; off: along that side */
  const SHOPS = [
    // Гавань Лёхи
    { id: 'harbor_burger', kind: 'food', menu: 'burger', name: 'Порт-Бургер', sub: 'бургеры · фри · кола', icon: '🍔', tag: 'ЕДА', hex: '#ff8a3d', b: [-91, -17, -77, -9], face: '-x' },
    { id: 'harbor_wear', kind: 'clothes', stock: 'harbor', name: 'Портовый стиль', sub: 'кожа · деним · рабочая одежда', icon: '🧥', tag: 'ОДЕЖДА', hex: '#4fa8ff', b: [-91, -41, -69, -20], face: '-x' },
    // Лёха-Хайтс
    { id: 'heights_luxe', kind: 'clothes', stock: 'luxe', name: 'LEHA LUXE', sub: 'люкс · золото · бриллианты', icon: '💎', tag: 'ЛЮКС', hex: '#ffd84f', b: [-91, 59, -67, 81], face: '-x' },
    // Рынок «Неплохо»
    { id: 'market_taco', kind: 'food', menu: 'taco', name: 'Тако Неплохо', sub: 'тако · буррито · начос', icon: '🌮', tag: 'ЕДА', hex: '#ffcf3f', b: [-41, -91, -26.6, -77], face: '-z' },
    { id: 'market_247', kind: 'market', name: 'Неплохо 24/7', sub: 'продукты · аптечки · лотерея', icon: '🛒', tag: '24/7', hex: '#5fd38a', b: [-23.5, -91, -9, -76.9], face: '-z' },
    // Даунтаун
    { id: 'down_pizza', kind: 'food', menu: 'pizza', name: 'Pizza NEPLOXO', sub: 'пицца из дровяной печи', icon: '🍕', tag: 'ПИЦЦА', hex: '#ff4f4f', b: [-23, -40.5, -9.5, -9.5], face: '+x' },
    // Бульвар Not Bad
    { id: 'blvd_lobster', kind: 'food', menu: 'lobster', name: 'Lobster Bay', sub: 'ресторан морепродуктов', icon: '🦞', tag: 'РЕСТОРАН', hex: '#ff6a5a', b: [59, -41, 68, -9], face: '-x' },
    // Пойнт 21 (остров Палм)
    { id: 'point_beach', kind: 'clothes', stock: 'beach', name: 'Beach Club Wear', sub: 'пляжная одежда · очки · панамы', icon: '🩳', tag: 'ОДЕЖДА', hex: '#3fe6e0', b: [387, -14, 405, -7], face: '+z' },
    { id: 'point_sushi', kind: 'food', menu: 'sushi', name: 'Sushi Point', sub: 'роллы · сеты · саке', icon: '🍣', tag: 'СУШИ', hex: '#ff4fa3', b: [445, -14, 463, -7], face: '+z' },
    { id: 'point_coco', kind: 'food', menu: 'coco', name: 'Coco Café', sub: 'кокосы · смузи · коктейли', icon: '🥥', tag: 'КАФЕ', hex: '#8cff6b', b: [387, -54, 405, -46], face: '-z' },
    { id: 'point_247', kind: 'market', name: 'Point 24/7', sub: 'продукты · аптечки · лотерея', icon: '🛒', tag: '24/7', hex: '#5fd38a', b: [445, -54, 463, -46], face: '-z' },
    // Район 21
    { id: 'cobra_shawa', kind: 'food', menu: 'shawarma', name: 'Шаурма 21', sub: 'шаурма · шашлык · айран', icon: '🥙', tag: 'ЕДА', hex: '#ff4f4f', b: [-91, -214, -76, -199], face: '-x' },
    { id: 'cobra_street', kind: 'clothes', stock: 'street', name: 'STREET 21', sub: 'уличная одежда · кепки · кроссы', icon: '🧢', tag: 'ОДЕЖДА', hex: '#ff2d7a', b: [9, -231, 24, -216], face: '-x' },
    { id: 'n21_247', kind: 'market', name: 'Район 24/7', sub: 'продукты · аптечки · лотерея', icon: '🛒', tag: '24/7', hex: '#5fd38a', b: [59, -264, 74, -249], face: '-x' },
    { id: 'skull_pizza', kind: 'food', menu: 'pizza', name: 'Пицца «Черепа»', sub: 'пицца · кальцоне', icon: '🍕', tag: 'ПИЦЦА', hex: '#8cff6b', b: [159, -231, 174, -216], face: '-x' },
    // Бэйвью
    { id: 'west_mall', kind: 'clothes', stock: 'mall', name: 'Bayview Mall', sub: 'одежда · обувь · аксессуары', icon: '🛍', tag: 'ОДЕЖДА', hex: '#c28bff', b: [406.5, -231, 421.5, -216], face: '-x' },
    { id: 'west_donut', kind: 'food', menu: 'donut', name: 'Bayview Donuts', sub: 'пончики · кофе · шейки', icon: '🍩', tag: 'ПОНЧИКИ', hex: '#ff7eb6', b: [423.5, -231, 438.5, -216], face: '+x' },
    { id: 'view_bbq', kind: 'food', menu: 'bbq', name: 'BBQ Лёха-Вью', sub: 'рёбрышки · гриль · пиво', icon: '🍖', tag: 'ГРИЛЬ', hex: '#ff8a3d', b: [456.5, -214, 472.8, -199], face: '-x' },
    { id: 'view_247', kind: 'market', name: 'Bayview 24/7', sub: 'продукты · аптечки · лотерея', icon: '🛒', tag: '24/7', hex: '#5fd38a', b: [474.8, -214, 491, -199], face: '+x' },
    { id: 'east_cafe', kind: 'food', menu: 'cafe', name: 'East Side Café', sub: 'кофе · выпечка · сэндвичи', icon: '☕', tag: 'КАФЕ', hex: '#ffcf3f', b: [690, -310, 730, -300], face: '-x' }
  ];
  /* ---------- homes ----------
     One ladder: the better the home, the higher both the price and the rent. Rent per real day comes from the
     price by one rule (rentFor), so it always grows with it: ~0.7% of the price for a dorm room, up to ~0.85%
     for the mansion. Most homes are cheap flats in blocks — one door, many flats behind it, enough for a
     hundred players and more. */
  const rentFor = price => Math.round(price * (.007 + .0015 * Math.min(1, price / 1e6)) / 5) * 5;
  // blocks of flats: units = floors × perFloor; the price goes up a step with every floor
  const BLOCKS = [
    // economy studios (one small room) — Район 21
    { id: 'b_dorm', tier: 'studio', name: 'Общежитие «Район 21»', where: 'Район 21', floors: 4, perFloor: 4, price: 6000, step: 0, b: [76, -281, 91, -266], face: '+x' },
    { id: 'b_cobra1', tier: 'studio', name: 'ЖК «Кобра»', where: 'Район 21, земля Кобр', floors: 6, perFloor: 2, price: 9000, step: 500, b: [9, -264, 24, -249], face: '-x' },
    { id: 'b_cobra2', tier: 'studio', name: 'ЖК «Кобра-2»', where: 'Район 21, земля Кобр', floors: 6, perFloor: 2, price: 9000, step: 500, b: [9, -314, 24, -299], face: '-x' },
    { id: 'b_cobra3', tier: 'studio', name: 'Дом на Кобра-стрит', where: 'Район 21, земля Кобр', floors: 6, perFloor: 2, price: 9000, step: 500, b: [-74, -281, -59, -266], face: '+x' },
    { id: 'b_cobra4', tier: 'studio', name: 'Кирпичный дом у порта', where: 'Район 21, земля Кобр', floors: 6, perFloor: 2, price: 9000, step: 500, b: [-91, -331, -59, -305], face: '-x' },
    { id: 'b_skull1', tier: 'studio', name: 'ЖК «Череп»', where: 'Район 21, земля Черепов', floors: 6, perFloor: 2, price: 10000, step: 500, b: [109, -264, 124, -249], face: '-x' },
    { id: 'b_skull2', tier: 'studio', name: 'Фабричный дом', where: 'Район 21, земля Черепов', floors: 6, perFloor: 2, price: 10000, step: 500, b: [176, -214, 191, -199], face: '+x' },
    { id: 'b_skull3', tier: 'studio', name: 'Дом у трубы', where: 'Район 21, земля Черепов', floors: 6, perFloor: 2, price: 10000, step: 500, b: [226, -281, 241, -266], face: '+x' },
    { id: 'b_skull4', tier: 'studio', name: 'ЖК «Восток-21»', where: 'Район 21, земля Черепов', floors: 6, perFloor: 2, price: 10000, step: 500, b: [159, -214, 174, -199], face: '-x' },
    // ordinary flats (sofa, kitchen, bedroom) — the market, the harbour, Bayview
    { id: 'b_market', tier: 'flat', name: 'Дом над лавками', where: 'Рынок «Неплохо»', floors: 5, perFloor: 2, price: 20000, step: 1000, b: [-41, -73.2, -27.6, -59], face: '-x' },
    { id: 'b_harbor1', tier: 'flat', name: 'ЖК «Причал»', where: 'Гавань Лёхи', floors: 5, perFloor: 2, price: 28000, step: 1500, b: [-91, -73.2, -76.9, -59], face: '-x' },
    { id: 'b_harbor2', tier: 'flat', name: 'ЖК «Маяк»', where: 'Гавань Лёхи', floors: 5, perFloor: 2, price: 28000, step: 1500, b: [-73.6, -91, -59, -78], face: '+x' },
    { id: 'b_west', tier: 'flat', name: 'Bayview Residence', where: 'Бэйвью: Уэст-Энд', floors: 5, perFloor: 2, price: 38000, step: 2000, b: [355, -330, 387.5, -320], face: '-x' },
    { id: 'b_west2', tier: 'flat', name: 'Уэст-Энд Апартаменты', where: 'Бэйвью: Уэст-Энд', floors: 5, perFloor: 2, price: 38000, step: 2000, b: [407.5, -360, 437.5, -350], face: '-x' },
    { id: 'b_view', tier: 'flat', name: 'ЖК «Лёха-Вью»', where: 'Бэйвью: Лёха-Вью', floors: 5, perFloor: 2, price: 38000, step: 2000, b: [570, -230, 610, -220], face: '-z' },
    { id: 'b_east', tier: 'flat', name: 'ЖК «Ист-Сайд»', where: 'Бэйвью: Ист-Сайд', floors: 5, perFloor: 2, price: 38000, step: 2000, b: [690, -330, 730, -320], face: '-x' }
  ];
  // homes with a door of their own, cheapest first (the beach villa from places.js sits on the same ladder)
  const HOMES = [
    { id: 'h_cobra', tier: 'flat', name: 'Квартира у Кобр', where: 'Район 21', price: 16000, b: [-74, -264, -59, -249], face: '+z' },
    { id: 'h_factory', tier: 'flat', name: 'Лофт у фабрики', where: 'Район 21, земля Черепов', price: 19000, b: [209, -264, 224, -249], face: '-x' },
    { id: 'h_market', tier: 'flat', name: 'Квартира над рынком', where: 'Рынок «Неплохо»', price: 26000, b: [-22.1, -72.3, -9, -59], face: '+x' },
    { id: 'h_harbor', tier: 'flat', name: 'Квартира в Гавани', where: 'Гавань Лёхи', price: 34000, b: [-72.9, -72.9, -59, -59], face: '+z' },
    { id: 'h_view', tier: 'flat', name: 'Квартира в Лёха-Вью', where: 'Бэйвью', price: 48000, b: [570, -210, 610, -200], face: '-x' },
    { id: 'h_east', tier: 'flat', name: 'Квартира в Ист-Сайде', where: 'Бэйвью', price: 52000, b: [630, -260, 670, -250], face: '-x' },
    { id: 'h_q21', tier: 'flat', name: 'Апартаменты Квартал 21', where: 'Квартал 21', price: 85000, b: [-41, 77.7, -26.7, 91], face: '-x' },
    { id: 'h_west', tier: 'house', name: 'Дом в Уэст-Энде', where: 'Бэйвью', price: 110000, b: [357.1, -212.5, 366.3, -205], face: '-x' },
    { id: 'h_viewhouse', tier: 'house', name: 'Дом в Лёха-Вью', where: 'Бэйвью', price: 125000, b: [510, -212.5, 519.2, -205], face: '-x' },
    { id: 'h_loft', tier: 'flat', name: 'Лофт в Даунтауне', where: 'Даунтаун NEPLOXO', price: 130000, b: [-40.5, 27, -9.5, 40.5], face: '-x' },
    { id: 'h_easthouse', tier: 'house', name: 'Дом в Ист-Сайде', where: 'Бэйвью', price: 140000, b: [629.6, -212.5, 638.8, -205], face: '-x' },
    { id: 'h_sea', tier: 'flat', name: 'Апартаменты у моря', where: 'Бульвар Not Bad', price: 190000, b: [71, 59, 91, 74], face: '-z' },
    { id: 'h_pointbeach', tier: 'flat', name: 'Апарт-отель Point Beach', where: 'Пляж Пойнт 21', price: 240000, b: [410, -92, 440, -70], face: '+z' },
    { id: 'h_townhouse', tier: 'house', name: 'Таунхаус в Лёха-Хайтс', where: 'Лёха-Хайтс', price: 300000, b: [-91, 84, -75, 91], face: '+z' },
    { id: 'h_mansion', tier: 'mansion', name: 'Особняк Хайтс Not Bad', where: 'Хайтс Not Bad, остров Палм', price: 900000, b: [387, 8, 411, 8.3], face: '-z', gate: true }   // the walled estate: in through the gate
  ];
  for (const h of HOMES) h.rent = rentFor(h.price);
  const TIER = {
    studio: { room: 'home_studio', word: 'Студия', icon: '🏘', hex: '#8cff6b', inside: 'Маленькая комната: кровать, раковина, плитка, старый телевизор' },
    flat: { room: 'home_flat', word: 'Квартира', icon: '🏢', hex: '#3fe6e0', inside: 'Комната с диваном и ТВ, кухня, спальня' },
    house: { room: 'home_house', word: 'Дом', icon: '🏡', hex: '#ffb347', inside: 'Гостиная с камином, кухня, столовая, спальня' },
    mansion: { room: 'home_mansion', word: 'Особняк', icon: '🏰', hex: '#ffd84f', inside: 'Мраморный зал, бар, рояль, аквариум, спальня с круглой кроватью' }
  };
  const ROOM = { clothes: 'shop_clothes', food: 'shop_food', market: 'shop_market' };

  // the spot on the pavement in front of the middle of a building's side
  function doorOf(s, fronts) {
    const [x0, z0, x1, z1] = s.b, off = s.off || 0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const n = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[s.face];
    const wx = s.face === '+x' ? x1 : s.face === '-x' ? x0 : cx + off, wz = s.face === '+z' ? z1 : s.face === '-z' ? z0 : cz + off;
    const x = wx + n[0] * 1.3, z = wz + n[1] * 1.3;
    return { x, z, y: fronts.groundAt(x, z), nx: n[0], nz: n[1], heading: Math.atan2(n[0], n[1]), cx, cz, wall: 1.3 };
  }

  NB.createShops = function (o) {
    // o: places, fronts, ui, player, progress, money { get, spend, add }, flash, save, sleep, drunk, audio, leave, villa { price, door }
    const P = o.progress;
    if (!P.homes || typeof P.homes !== 'object') P.homes = {};
    const now = () => (NB.online && NB.online.now ? NB.online.now() : Date.now());
    const G = { player: o.player, money: o.money, drunk: o.drunk };

    /* ---------- shops ---------- */
    for (const s of SHOPS) {
      const d = doorOf(s, o.fronts); d.hex = s.hex; s.door = d;
      s.entrance = o.fronts.add(Object.assign({}, d, { hex: s.hex, title: s.name, sub: s.sub, icon: s.icon, tag: s.tag }));
      const info = { name: s.name, title: s.name, sub: s.sub, hex: s.hex, use: what => {
        if (s.kind === 'clothes') { if (what === 'buy') o.ui.boutique(s.name, STOCK[s.stock]); return; }
        const list = s.kind === 'market' ? MENUS.market : MENUS[s.menu];
        o.ui.menu({ eyebrow: s.name, title: s.kind === 'market' ? 'Касса' : 'Меню', items: () => list.map(([name, price, f]) => Object.assign({ name, price }, f(G))) });
      } };
      o.places.addDoor(ROOM[s.kind], d, info);
    }

    /* ---------- homes ---------- */
    const ALL = {};   // every home by id: the single ones, every flat in every block, the villa
    const rec = id => P.homes[id];
    const owned = h => h.id === 'villa' ? !!P.villa : !!rec(h.id);
    const ok = h => { const r = rec(h.id); return owned(h) && (!r || now() <= r.paid); };
    const due = h => { const r = rec(h.id); return r ? Math.max(1, Math.ceil((now() - r.paid) / DAY)) * h.rent : 0; };
    const paidPrice = h => { const r = rec(h.id); return (r && r.price) || h.price; };
    function refresh(h) {
      if (h.block) return refreshBlock(h.block);
      const e = h.entrance; if (!e) return;
      const r = rec(h.id), t = !owned(h) ? 'ПРОДАЁТСЯ · ' + fmt(h.price) : r && now() > r.paid ? 'ДОЛГ · ' + fmt(due(h)) : 'ВАШ ДОМ';
      if (e.hint !== t) { e.hint = t; e.sub = (!owned(h) ? fmt(h.price) + ' · ' : '') + fmt(h.rent) + ' в день'; e.redraw(); }
    }
    const mineIn = B => B.units.find(u => owned(u));
    function refreshBlock(B) {
      const u = mineIn(B), r = u && rec(u.id), free = B.units.filter(x => !owned(x)).length;
      const t = u ? (r && now() > r.paid ? 'ДОЛГ · ' + fmt(due(u)) : 'ВАША ' + (B.tier === 'studio' ? 'СТУДИЯ' : 'КВАРТИРА') + ' · №' + u.n) : 'КВАРТИРЫ ОТ ' + fmt(B.units[0].price);
      if (B.entrance.hint !== t) { B.entrance.hint = t; B.entrance.sub = B.units.length + ' квартир · свободно ' + free + ' · от ' + fmt(B.units[0].rent) + ' в день'; B.entrance.redraw(); }
    }
    function buy(h) {
      P.homes[h.id] = { paid: now() + DAY, t: now(), price: h.price }; o.save(); refresh(h); o.audio.fare();
      return 'Поздравляем! Теперь это ваше жильё: ' + h.name + '. Заходите в дверь';
    }
    const about = h => [
      { name: 'Что внутри', desc: TIER[h.tier].inside, price: 0, disabled: 'Кровать · гардероб', buy: () => '' },
      { name: 'Как платить', desc: 'Аренда ' + fmt(h.rent) + ' в сутки списывается с наличных сама. Без денег дверь закрыта до оплаты; 14 дней без оплаты — жильё уходит в продажу, половина цены вернётся', price: 0, disabled: 'Понятно', buy: () => '' }
    ];
    function buyMenu(h) {
      const T = TIER[h.tier];
      o.ui.menu({ eyebrow: T.word + ' · ' + h.where, title: h.name, items: () => owned(h) ? [{ name: 'Это ваше жильё', desc: 'Заходите', price: 0, disabled: 'Ваше', buy: () => '' }] :
        [{ name: 'Купить: ' + T.word.toLowerCase(), desc: 'Цена ' + fmt(h.price) + ' · аренда ' + fmt(h.rent) + ' в сутки (первые сутки включены)', price: h.price, label: 'Купить', buy: () => buy(h) }].concat(about(h)) });
    }
    // the door of a block: pick a flat (one per block for each player)
    function blockMenu(B) {
      o.ui.menu({ eyebrow: B.where + ' · ' + B.units.length + ' квартир', title: B.name, items: () => {
        const mine = mineIn(B);
        return B.units.map(u => ({ name: (B.tier === 'studio' ? 'Студия' : 'Квартира') + ' №' + u.n + ' · ' + u.floor + ' этаж', desc: 'Аренда ' + fmt(u.rent) + ' в сутки', price: owned(u) ? 0 : u.price, label: 'Купить',
          current: owned(u), disabled: owned(u) ? 'Ваша' : mine ? 'У вас уже есть квартира здесь' : '', buy: () => buy(u) })).concat(about(B.units[0]));
      } });
    }
    function payDebt(h) { const r = rec(h.id); if (!r) return 'Не ваше'; const n = Math.max(1, Math.ceil((now() - r.paid) / DAY)); r.paid += n * DAY; o.save(); refresh(h); return 'Оплачено: ' + n + ' сут.'; }
    function debtMenu(h) {
      o.ui.menu({ eyebrow: 'Долг за жильё', title: h.name, items: () => {
        const r = rec(h.id); if (!r || now() <= r.paid) return [{ name: 'Долга нет', price: 0, disabled: 'Заходите', buy: () => '' }];
        return [{ name: 'Оплатить долг', desc: 'Не оплачено суток: ' + Math.ceil((now() - r.paid) / DAY), price: due(h), label: 'Оплатить', buy: () => payDebt(h) }];
      } });
    }
    function homeMenu(h) {
      o.ui.menu({ eyebrow: h.where, title: h.name, items: () => {
        const r = rec(h.id); if (!r) return [];
        const left = Math.max(0, r.paid - now()), d = Math.floor(left / DAY), hh = Math.floor(left % DAY / 3600000), back = Math.round(paidPrice(h) / 2);
        return [
          { name: 'Оплачено ещё ' + d + ' сут. ' + hh + ' ч', desc: 'Аренда ' + fmt(h.rent) + ' в сутки, списывается сама', price: 0, disabled: 'Ок', buy: () => '' },
          { name: 'Оплатить вперёд на 7 суток', desc: 'Чтобы точно не остаться без дома', price: h.rent * 7, label: 'Оплатить', buy: () => { r.paid += 7 * DAY; o.save(); return 'Оплачено на неделю вперёд'; } },
          { name: P.homeSpawn === h.id ? 'Вы просыпаетесь здесь' : 'Просыпаться здесь', desc: 'При входе в игру вы появитесь у этой двери', price: 0, label: 'Выбрать', disabled: P.homeSpawn === h.id ? 'Выбрано' : '', buy: () => { P.homeSpawn = h.id; o.save(); return 'Теперь вы просыпаетесь здесь'; } },
          { name: 'Продать', desc: 'Вернётся половина цены: ' + fmt(back), price: -back, buy: () => { delete P.homes[h.id]; if (P.homeSpawn === h.id) P.homeSpawn = null; o.save(); refresh(h); setTimeout(() => { o.ui.close(); o.leave(); }, 600); return 'Продано'; } }
        ];
      } });
    }
    const inside = h => ({
      sleep: () => { P.homeSpawn = h.id; o.sleep('Вы выспались. Игра сохранена. Теперь вы просыпаетесь здесь'); },
      home: () => homeMenu(h)
    });

    // homes with their own door
    for (const h of HOMES) {
      const T = TIER[h.tier], d = doorOf(h, o.fronts); d.hex = T.hex; h.door = d; ALL[h.id] = h;
      h.entrance = o.fronts.add(Object.assign({}, d, { hex: T.hex, title: h.name, sub: '', icon: T.icon, tag: T.word.toUpperCase(), hint: '', boardW: h.tier === 'house' ? 4.4 : 5.6, pillars: !!h.gate, canopy: !h.gate }));
      refresh(h);
      o.places.addDoor(T.room, d, { name: h.name, title: h.name, sub: h.where, hex: T.hex, enabled: () => ok(h), locked: () => (owned(h) ? debtMenu : buyMenu)(h), use: what => { const f = inside(h)[what]; if (f) f(); } });
    }
    // blocks of flats: one door, the flat you own behind it
    for (const B of BLOCKS) {
      const T = TIER[B.tier], d = doorOf(B, o.fronts); d.hex = T.hex; B.door = d;
      B.units = [];
      for (let i = 0; i < B.floors * B.perFloor; i++) {
        const floor = 1 + ((i / B.perFloor) | 0), price = B.price + (floor - 1) * B.step;
        const u = { id: B.id + '_' + (i + 1), n: i + 1, floor, block: B, tier: B.tier, where: B.where, name: B.name + ', кв. ' + (i + 1), price, rent: rentFor(price), door: d };
        B.units.push(u); ALL[u.id] = u;
      }
      B.entrance = o.fronts.add(Object.assign({}, d, { hex: T.hex, title: B.name, sub: '', icon: T.icon, tag: 'КВАРТИРЫ', hint: '' }));
      refreshBlock(B);
      const info = { name: B.name, title: B.name, sub: B.where, hex: T.hex,
        enabled: () => { const u = mineIn(B); if (!u || !ok(u)) return false; info.name = u.name; return true; },   // in you go, to your own flat
        locked: () => { const u = mineIn(B); if (u) debtMenu(u); else blockMenu(B); },
        use: what => { const u = mineIn(B); if (u) { const f = inside(u)[what]; if (f) f(); } } };
      o.places.addDoor(T.room, d, info);
    }
    // the beach villa (built in places.js, bought at its gate): it pays rent like every other home
    const villa = o.villa ? { id: 'villa', tier: 'mansion', name: 'Вилла на пляже', where: 'Пляж Not Bad', price: o.villa.price, rent: rentFor(o.villa.price) } : null;
    if (villa) { ALL.villa = villa; if (P.villa && !rec('villa')) P.homes.villa = { paid: now() + DAY, t: now(), price: 4000 }; }   // bought before rent existed: rent starts today

    // rent: taken from cash once a real day; with no cash the door locks; 14 days unpaid and the home is gone
    let tickT = 0;
    function tick(dt) {
      if ((tickT -= dt) > 0) return; tickT = 15;
      const t = now();
      if (villa && P.villa && !rec('villa')) P.homes.villa = { paid: t + DAY, t, price: villa.price };   // just bought at the gate
      for (const id in P.homes) {
        const h = ALL[id], r = P.homes[id];
        if (!h) continue;
        if (id === 'villa' && !P.villa) { delete P.homes.villa; continue; }
        while (t > r.paid && o.money.get() >= h.rent && t - r.paid < GRACE_DAYS * DAY) { o.money.spend(h.rent, 'Аренда: ' + h.name); r.paid += DAY; o.save(); }
        if (t - r.paid >= GRACE_DAYS * DAY) {
          const back = Math.round(paidPrice(h) / 2);
          delete P.homes[id]; if (id === 'villa') P.villa = false; if (P.homeSpawn === id) P.homeSpawn = null;
          o.money.add(back, 'Жильё продано за долги');
          o.flash(h.name + ': 14 дней без оплаты — жильё ушло в продажу, вернули ' + fmt(back), 5); o.save();
        } else if (t > r.paid && !r.warned) { r.warned = true; o.flash('Не хватает на аренду: ' + h.name + ' закрыто до оплаты', 4); }
        else if (t <= r.paid) r.warned = false;
      }
      for (const h of HOMES) refresh(h);
      for (const B of BLOCKS) refreshBlock(B);
    }

    const units = BLOCKS.reduce((n, B) => n + B.units.length, 0);
    return {
      shops: SHOPS, homes: HOMES, blocks: BLOCKS, tick, rentFor,
      count: { blocks: BLOCKS.length, units, singles: HOMES.length, total: units + HOMES.length + (villa ? 1 : 0) },
      // a home's door opens only while its rent is paid (the villa asks this)
      ok: id => { const h = ALL[id]; return !h || ok(h); },
      villaRent: () => villa ? villa.rent : 0,
      // where to wake up: the door of the home you last slept in, if it's still yours
      spawn() { const h = ALL[P.homeSpawn]; if (!h || !h.door || !owned(h)) return null; const d = h.door; return { x: d.x + d.nx * 2.2, z: d.z + d.nz * 2.2, heading: d.heading, y: d.y }; },
      // for the maps
      icons() {
        const out = [];
        for (const s of SHOPS) out.push({ x: s.door.cx, z: s.door.cz, bg: s.hex, fg: '#141018', ch: s.icon, label: s.name + ': ' + s.sub });
        for (const h of HOMES) { const mine = owned(h), T = TIER[h.tier]; out.push({ x: h.door.cx, z: h.door.cz, bg: mine ? '#ffffff' : T.hex, fg: '#141018', ch: mine ? '⌂' : T.icon, label: mine ? 'Ваше жильё: ' + h.name : T.word + ' «' + h.name + '» · ' + fmt(h.price) + ' · ' + fmt(h.rent) + '/сутки', mine }); }
        for (const B of BLOCKS) { const mine = !!mineIn(B), T = TIER[B.tier]; out.push({ x: B.door.cx, z: B.door.cz, bg: mine ? '#ffffff' : T.hex, fg: '#141018', ch: mine ? '⌂' : T.icon, label: mine ? 'Ваша квартира: ' + mineIn(B).name : B.name + ': ' + B.units.length + ' квартир от ' + fmt(B.units[0].price) + ' · ' + fmt(B.units[0].rent) + '/сутки', mine }); }
        return out;
      }
    };
  };
  NB.SHOP_LIST = SHOPS; NB.HOME_LIST = HOMES; NB.HOME_BLOCKS = BLOCKS;
})(window.NB);
