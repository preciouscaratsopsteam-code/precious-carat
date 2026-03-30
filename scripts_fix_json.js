const fs = require('fs');
const file = '/Users/jaskiratsingh/Development/StoreApp/templates/index.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// 1. Revert Upratnas strictly to the Navratna content as per mockup
if (data.sections.upratnas) {
    data.sections.upratnas.blocks = JSON.parse(JSON.stringify(data.sections.navratnas.blocks));
    data.sections.upratnas.block_order = [...data.sections.navratnas.block_order];
}

// 2. Adjust featured products (crush-worthy delights)
if (data.sections.featured) {
    data.sections.featured.settings.asset_name = 'crush-1.jpg'; // This looks like the promo banner left
}

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log("Fixed index.json");
