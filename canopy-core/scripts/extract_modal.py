import re
import os

page_path = '../canopy-ui/src/pages/ObjectsPage.tsx'
modal_path = '../canopy-ui/src/components/GlobalObjectCrudModal.tsx'

with open(page_path, 'r') as f:
    content = f.read()

print("File read successfully")
