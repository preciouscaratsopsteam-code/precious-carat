import re

with open('/Users/jaskiratsingh/Development/StoreApp/sections/main-article.liquid', 'r', encoding='utf-8') as f:
    text = f.read()

target = """        {%- capture sidebar_products_html -%}
          {%- assign match_limit = 10 -%}
          {%- assign match_count = 0 -%}
          {%- assign matched_ids = ',' -%}

          {%- for p in collections.all.products -%}
            {%- if match_count >= match_limit -%}{%- break -%}{%- endif -%}
            {%- assign id_key = ',' | append: p.id | append: ',' -%}
            {%- if matched_ids contains id_key -%}{%- continue -%}{%- endif -%}
            {%- assign gtype = p.metafields.custom.gem_type | downcase -%}
            {%- if gtype == blank -%}{%- continue -%}{%- endif -%}
            {%- assign matched = false -%}
            {%- for tag in article.tags -%}
              {%- assign tl = tag | downcase -%}
              {%- if gtype contains tl or tl contains gtype -%}
                {%- assign matched = true -%}
                {%- break -%}
              {%- endif -%}
            {%- endfor -%}
            {%- if matched -%}
              {%- assign matched_ids = matched_ids | append: p.id | append: ',' -%}
              {%- assign match_count = match_count | plus: 1 -%}
              <a class="article-page__sidebar-product" href="{{ p.url }}">
                {%- if p.featured_image -%}
                  <img src="{{ p.featured_image | image_url: width: 160 }}" alt="{{ p.featured_image.alt | default: p.title | escape }}" loading="lazy">
                {%- else -%}
                  <span class="article-page__sidebar-product-placeholder"></span>
                {%- endif -%}
                <span class="article-page__sidebar-product-info">
                  <span class="article-page__sidebar-product-title">{{ p.title }}</span>
                  <span class="article-page__sidebar-product-price">
                    {%- if p.price > 100000000 -%}Price on request{%- else -%}{{ p.price | money }}{%- endif -%}
                  </span>
                </span>
              </a>
            {%- endif -%}
          {%- endfor -%}
        {%- endcapture -%}"""

replacement = """        {%- capture sidebar_products_html -%}
          {%- assign match_limit = 10 -%}
          {%- assign match_count = 0 -%}
          {%- assign matched_ids = ',' -%}
          {%- assign tag_count = article.tags.size -%}
          {%- assign limit_per_tag = match_limit -%}

          {%- if tag_count > 0 -%}
            {%- assign limit_per_tag = match_limit | divided_by: tag_count -%}
            {%- if limit_per_tag < 1 -%}{%- assign limit_per_tag = 1 -%}{%- endif -%}
          {%- endif -%}

          {%- comment -%} Pass 1: Get an equal number of products for each tag {%- endcomment -%}
          {%- for tag in article.tags -%}
            {%- assign tl = tag | downcase -%}
            {%- assign tag_match_count = 0 -%}
            
            {%- for p in collections.all.products -%}
              {%- if tag_match_count >= limit_per_tag -%}{%- break -%}{%- endif -%}
              {%- if match_count >= match_limit -%}{%- break -%}{%- endif -%}
              
              {%- assign id_key = ',' | append: p.id | append: ',' -%}
              {%- if matched_ids contains id_key -%}{%- continue -%}{%- endif -%}
              
              {%- assign gtype = p.metafields.custom.gem_type | downcase -%}
              {%- if gtype == blank -%}{%- continue -%}{%- endif -%}
              
              {%- if gtype contains tl or tl contains gtype -%}
                {%- assign matched_ids = matched_ids | append: p.id | append: ',' -%}
                {%- assign tag_match_count = tag_match_count | plus: 1 -%}
                {%- assign match_count = match_count | plus: 1 -%}
                <a class="article-page__sidebar-product" href="{{ p.url }}">
                  {%- if p.featured_image -%}
                    <img src="{{ p.featured_image | image_url: width: 160 }}" alt="{{ p.featured_image.alt | default: p.title | escape }}" loading="lazy">
                  {%- else -%}
                    <span class="article-page__sidebar-product-placeholder"></span>
                  {%- endif -%}
                  <span class="article-page__sidebar-product-info">
                    <span class="article-page__sidebar-product-title">{{ p.title }}</span>
                    <span class="article-page__sidebar-product-price">
                      {%- if p.price > 100000000 -%}Price on request{%- else -%}{{ p.price | money }}{%- endif -%}
                    </span>
                  </span>
                </a>
              {%- endif -%}
            {%- endfor -%}
          {%- endfor -%}

          {%- comment -%} Pass 2: Fill remaining slots up to match_limit {%- endcomment -%}
          {%- if match_count < match_limit -%}
            {%- for p in collections.all.products -%}
              {%- if match_count >= match_limit -%}{%- break -%}{%- endif -%}
              {%- assign id_key = ',' | append: p.id | append: ',' -%}
              {%- if matched_ids contains id_key -%}{%- continue -%}{%- endif -%}
              
              {%- assign gtype = p.metafields.custom.gem_type | downcase -%}
              {%- if gtype == blank -%}{%- continue -%}{%- endif -%}
              
              {%- assign matched = false -%}
              {%- for tag in article.tags -%}
                {%- assign tl = tag | downcase -%}
                {%- if gtype contains tl or tl contains gtype -%}
                  {%- assign matched = true -%}
                  {%- break -%}
                {%- endif -%}
              {%- endfor -%}
              
              {%- if matched -%}
                {%- assign matched_ids = matched_ids | append: p.id | append: ',' -%}
                {%- assign match_count = match_count | plus: 1 -%}
                <a class="article-page__sidebar-product" href="{{ p.url }}">
                  {%- if p.featured_image -%}
                    <img src="{{ p.featured_image | image_url: width: 160 }}" alt="{{ p.featured_image.alt | default: p.title | escape }}" loading="lazy">
                  {%- else -%}
                    <span class="article-page__sidebar-product-placeholder"></span>
                  {%- endif -%}
                  <span class="article-page__sidebar-product-info">
                    <span class="article-page__sidebar-product-title">{{ p.title }}</span>
                    <span class="article-page__sidebar-product-price">
                      {%- if p.price > 100000000 -%}Price on request{%- else -%}{{ p.price | money }}{%- endif -%}
                    </span>
                  </span>
                </a>
              {%- endif -%}
            {%- endfor -%}
          {%- endif -%}
        {%- endcapture -%}"""

if target in text:
    text = text.replace(target, replacement)
    with open('/Users/jaskiratsingh/Development/StoreApp/sections/main-article.liquid', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Successfully replaced.")
else:
    print("Target not found.")
