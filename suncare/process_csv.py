import json
import csv
import os

# 1. Read Product Descriptions
product_descriptions = {}
with open('csv/products.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        upc = row['UPC'].strip().lstrip('0') # Normalize UPC by removing leading zeros
        desc = row['Description'].strip()
        product_descriptions[upc] = desc

def normalize_upc(upc_raw):
    # CSVs might have leading quotes or zeros
    clean = upc_raw.replace('=', '').replace('"', '').strip().lstrip('0')
    return clean

dimensions = {}
dimensions_path = os.path.join('data', 'dimensions.json')
if os.path.exists(dimensions_path):
    with open(dimensions_path, 'r') as f:
        data = json.load(f)
        dimensions = data.get('dimensions', {})

removed_by_planogram = {}
removed_path = os.path.join('data', 'removed-products.json')
if os.path.exists(removed_path):
    with open(removed_path, 'r') as f:
        removed_by_planogram = json.load(f)

def get_product_name(upc, default_name):
    clean_upc = normalize_upc(upc)
    if clean_upc in product_descriptions:
        return product_descriptions[clean_upc]
    return default_name

def process_csv_layout(csv_path, id_val, name_val, subtitle_val, pog_num, live_date, sides, shelves, redirects, allow_new_badges=True):
    products = []
    removed_products = []
    
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_upc = row['UPC']
            upc = normalize_upc(raw_upc)
            clean_upc_for_img = upc 
            
            is_new = (row['New Flag'] == '1')
            if not allow_new_badges:
                is_new = False

            is_deleted = True if row.get('Delete Flag') == '1' else False
            base = {
                "upc": clean_upc_for_img,
                "name": get_product_name(raw_upc, row['Product Name']),
            }
            if upc in dimensions:
                dims = dimensions[upc]
                base["widthIn"] = dims.get("widthIn")
                base["heightIn"] = dims.get("heightIn")

            if is_deleted:
                removed_products.append(base)
                continue

            p = {
                **base,
                "segment": int(row['POG Segment']),
                "shelf": int(row['Fixture']),
                "position": int(row['Position']),
                "facings": int(row['FW']) if row['FW'] else 1, # FW = Facings Wide?
                "isNew": is_new,
                "isMove": True if row.get('Move Flag') == '1' else False, # Endcap might not have Move Flag
                "isChange": False, 
                "srp": "SRP" if row.get('SRP') == 'SRP' else ""
            }
            products.append(p)
            
    products.sort(key=lambda x: (x['segment'], x['shelf'], x['position']))

    removed_from_pdf = removed_by_planogram.get(id_val, [])
    removed_map = {p["upc"]: p for p in removed_products}
    for p in removed_from_pdf:
        if p["upc"] not in removed_map:
            removed_map[p["upc"]] = p

    data = {
        "id": id_val,
        "name": name_val,
        "subtitle": subtitle_val,
        "pogNumber": pog_num,
        "liveDate": live_date,
        "sides": sides,
        "shelves": shelves,
        "totalProducts": len(products),
        "upcRedirects": redirects,
        "removedProducts": list(removed_map.values()),
        "products": products
    }
    
    return data

# Redirects (from prompt)
pallet_redirects = {
    "0007214003517": "0007214003912",
    "0081008487202": "0081011561524",
    "0081008487122": "0081011561523",
    "0081008487384": "0081011561522"
}
endcap_redirects = {
    "0007214003517": "0007214003912",
    "0081008487202": "0081011561524",
    "0081008487122": "0081011561523"
}

# Generate Pallet JSON (Allow New Badges)
pallet_data = process_csv_layout(
    'csv/Pallet Layout.csv', 
    'pallet', 
    '4-Sided Pallet', 
    'HP 62IN SUNCARE 5 SHELF 1 PEG 4 SIDED PALLET', 
    '185-SUNTAN 680', 
    '02-08-26', 
    4, 
    5, 
    pallet_redirects,
    allow_new_badges=True
)

# Generate Endcap JSON (DISABLE New Badges)
endcap_data = process_csv_layout(
    'csv/Endcap Layout.csv', 
    'endcap', 
    '4ft Endcap', 
    'FRED MEYER SUNCARE 6 SHELF ENDCAP SEASONAL', 
    '185-SUNTAN 150', 
    '02-08-26', 
    1, 
    6, 
    endcap_redirects,
    allow_new_badges=False
)

# Write files
with open('data/pallet.json', 'w') as f:
    json.dump(pallet_data, f, indent=2)
    
with open('data/endcap.json', 'w') as f:
    json.dump(endcap_data, f, indent=2)

print("Data generation complete.")
