import http.client
import mimetypes
import os

def post_multipart(host, port, endpoint, file_path):
    conn = http.client.HTTPConnection(host, port)
    
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    
    with open(file_path, "rb") as f:
        file_content = f.read()
        
    filename = os.path.basename(file_path)
    
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: text/xml\r\n\r\n"
    ).encode("utf-8") + file_content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body))
    }
    
    conn.request("POST", endpoint, body, headers)
    response = conn.getresponse()
    print("Status:", response.status)
    print("Response:", response.read().decode("utf-8"))
    conn.close()

post_multipart("127.0.0.1", 53042, "/api/paloalto/analyze", "/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/Panorama_20260422/TC-CADC-ICS-M600_017507002993.xml")
