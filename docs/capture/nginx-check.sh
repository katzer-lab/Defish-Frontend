#!/bin/bash
# Starts nginx:alpine (host network) with each of three configurations and tests static files, the proxy and uploads of different sizes.
# The configurations: nginx/fish-demo.conf.template as it was (old.conf), as it was with only the proxy port corrected (old_port_only.conf)
# and the current one (new.conf), each with 'listen' changed to 8088 / 8089 and 'root' pointing at the mounted build.
T=${T:-./nginx-test}   # holds old.conf, old_port_only.conf, new.conf, dist/ (the build) and the two test uploads
head -c 2097152 /dev/urandom > $T/two_mb.jpg   # a 2 MB "photo"
run() { # name conf port
  docker rm -f nginx_$1 >/dev/null 2>&1
  docker run -d --name nginx_$1 --network host -v $T/$2:/etc/nginx/conf.d/default.conf:ro -v $T/dist:/path/to/Defish-frontend/dist:ro nginx:alpine >/dev/null
  sleep 2
  echo "##### $1 ($2)"
  printf "GET /                : "; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$3/
  printf "GET /some/route      : "; curl -s -o /dev/null -w '%{http_code} (served the page)\n' http://127.0.0.1:$3/some/route
  printf "GET /api/            : "; curl -s -w '  [HTTP %{http_code}]\n' http://127.0.0.1:$3/api/ | cut -c1-120
  head -c 800000 /dev/urandom > $T/pic_08.jpg
  printf "POST 0.8 MB photo    : "; curl -s -o /dev/null -w '%{http_code}\n' -F "image=@$T/pic_08.jpg;filename=a.jpg" http://127.0.0.1:$3/api/analyze
  printf "POST 2 MB photo      : "; curl -s -o /dev/null -w '%{http_code}\n' -F "image=@$T/two_mb.jpg;filename=b.jpg" http://127.0.0.1:$3/api/analyze
  docker rm -f nginx_$1 >/dev/null
}
run old old.conf 8088
run old_port_only old_port_only.conf 8089
run new new.conf 8088
