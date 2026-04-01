const fs = require('fs');
const file = '/Users/jaskiratsingh/Development/StoreApp/templates/index.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Hero
if (data.sections.hero) {
    data.sections.hero.settings.asset_name = 'banner-navratna.jpg';
}

// Navratnas
if (data.sections.navratnas && data.sections.navratnas.blocks) {
    const map = {
        'Ruby': 'nav-ruby.png',
        'Pearl': 'nav-pearl.png',
        'Emerald': 'nav-emerald.png',
        'Cateye': 'nav-catseye.png',
        'Red Coral': 'nav-red-coral.png',
        'Blue Sapphire': 'nav-blue-sapphire.png',
        'Yellow Sapphire': 'nav-yellow-sapphire.png',
        'Hessonite': 'nav-hessonite.png',
        'White Sapphire': 'nav-white-sapphire.png'
    };
    for (const key in data.sections.navratnas.blocks) {
        const block = data.sections.navratnas.blocks[key];
        if (map[block.settings.name]) {
            block.settings.asset_name = map[block.settings.name];
        } else if (block.settings.name === 'White Sapphire') {
            block.settings.asset_name = 'nav-white-sapphire.png';
        }
    }
}

// Upratnas
if (data.sections.upratnas && data.sections.upratnas.blocks) {
    // Currently upratnas has the same blocks as navratnas in the JSON!
    // We should update the Upratnas blocks
    const upratnasMap = [
        { name: 'Citrine', asset: 'up-citrine.png' },
        { name: 'Garnet', asset: 'up-garnet.png' },
        { name: 'Lapis', asset: 'up-lapis.png' },
        { name: 'Malachite', asset: 'up-malachite.png' },
        { name: 'Moon Stone', asset: 'up-moonstone.png' },
        { name: 'Turquoise', asset: 'up-turquoise.png' },
        { name: 'Zircon', asset: 'up-zircon.png' },
        { name: 'Amethyst', asset: 'up-amethyst.png' },
        { name: 'Peridot', asset: 'up-peridot.png' }
    ];
    let i = 0;
    const order = [];
    data.sections.upratnas.blocks = {};
    for (const u of upratnasMap) {
        const key = 'gem_' + (i + 1);
        data.sections.upratnas.blocks[key] = {
            type: "gemstone",
            settings: {
                name: u.name,
                asset_name: u.asset
            }
        };
        order.push(key);
        i++;
    }
    data.sections.upratnas.block_order = order;
}

// Brand Story
if (data.sections.story) {
    data.sections.story.settings.asset_name = 'brand-2.jpg';
}

// Featured Products
if (data.sections.featured) {
    data.sections.featured.settings.asset_name = 'strand-1.jpg'; // Promo banner
}

// Sacred Essentials
if (data.sections.sacred) {
    data.sections.sacred.blocks = {
        "img1": { type: "image_block", settings: { asset_name: "brand-3.jpg" } },
        "card1": { type: "card_block", settings: { title: "RUBY", description: "Untreated", asset_name: "nav-ruby.png" } },
        "img2": { type: "image_block", settings: { asset_name: "brand-4.jpg" } },
        "card2": { type: "card_block", settings: { title: "EMERALD", description: "Untreated", asset_name: "nav-emerald.png" } },
        "img3": { type: "image_block", settings: { asset_name: "strand-2.jpg" } }
    };
    data.sections.sacred.block_order = ["img1", "card1", "img2", "card2", "img3"];
}

// Gems for everybody
if (data.sections.everybody) {
    data.sections.everybody.blocks = {
        "b1": { type: "collection_card", settings: { title: "Beyond Nine", subtitle: "The world beyond Navratnas", asset_name: "everybody-beyond.jpg" } },
        "b2": { type: "collection_card", settings: { title: "Strand Edit", subtitle: "Gemstone and pearl strands", asset_name: "everybody-strand.jpg" } },
        "b3": { type: "collection_card", settings: { title: "Sanctum", subtitle: "Where rarity meets reverence", asset_name: "everybody-sanctum.jpg" } }
    };
    data.sections.everybody.block_order = ["b1", "b2", "b3"];
}

// Transform Energy
if (data.sections.energy) {
    data.sections.energy.blocks = {
        "e1": { type: "energy_card", settings: { bg_text: "INTUITION", main_title: "MOONSTONE", title: "How Moonstone is helpful", asset_name: "up-moonstone.png" } },
        "e2": { type: "energy_card", settings: { bg_text: "WEALTH", main_title: "CITRINE", title: "Benefits of Citrine", asset_name: "up-citrine.png" } },
        "e3": { type: "energy_card", settings: { bg_text: "INTUITION", main_title: "MOONSTONE", title: "Why wear Moonstone", asset_name: "up-moonstone.png" } }
    };
    data.sections.energy.block_order = ["e1", "e2", "e3"];
}

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log("Updated index.json");
