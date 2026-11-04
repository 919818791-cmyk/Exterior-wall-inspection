import json
from pathlib import Path
import re
import subprocess

result=subprocess.run(['nginx','-T'],capture_output=True,text=True)
print('nginx -T exit:',result.returncode)
print(result.stderr.strip())
selected={'user','listen','server_name','root','index','client_max_body_size','client_body_timeout','send_timeout','proxy_read_timeout','proxy_send_timeout','proxy_connect_timeout','proxy_pass','proxy_buffering','proxy_request_buffering','proxy_http_version','proxy_set_header','proxy_redirect','proxy_cache','proxy_intercept_errors','client_body_temp_path','proxy_temp_path','fastcgi_temp_path','uwsgi_temp_path','scgi_temp_path','location','try_files','return','include','error_page','access_log','error_log'}
files=[]
for line in result.stdout.splitlines():
    if line.startswith('# configuration file '):
        name=line[len('# configuration file '):].rstrip(':')
        files.append(name)
        print('\nFILE',name)
    elif line.strip() and not line.lstrip().startswith('#'):
        match=re.match(r'\s*([^\s;{]+)',line)
        if match and match.group(1) in selected:
            sanitized=re.sub(r'(jscode=|key=|token=|signature=)[^&;\s]+',r'\1[redacted]',line)
            print(sanitized)
print('\nEnabled config files:',json.dumps(files))
for path in ['/var/lib/nginx/body','/var/lib/nginx/proxy','/var/lib/nginx/fastcgi','/var/lib/nginx/uwsgi','/var/lib/nginx/scgi','/var/lib/nginx/yolo-model-upload-body']:
    info=Path(path).stat()
    print('TEMP',path,'uid',info.st_uid,'gid',info.st_gid,'mode',oct(info.st_mode & 0o777))
for site in Path('/etc/nginx/sites-enabled').iterdir():
    print('SITE',site,'->',site.resolve())
