const fs = require('fs');
const file = '/Users/jaskiratsingh/Development/StoreApp/templates/index.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!data.sections.testimonials) {
    data.sections.testimonials = {
        type: "testimonials",
        blocks: {
            "r1": { type: "review" },
            "r2": { type: "review" },
            "r3": { type: "review" },
            "r4": { type: "review" },
            "r5": { type: "review" }
        },
        block_order: ["r1", "r2", "r3", "r4", "r5"]
    };
    
    // Add to order right before the end
    data.order.push("testimonials");
}

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log("Added testimonials to index.json");
