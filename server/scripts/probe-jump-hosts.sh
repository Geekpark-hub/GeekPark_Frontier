#!/bin/bash
set -u
hosts=(gp-main gp-pub gp-other gp-es gp-club gp-crm gp-mirror gp-nlp gp-galaxy gp-js-holoread gp-js-holobase)

remote_cmd='
echo "hostname=$(hostname)"
echo "uname=$(uname -srm)"
echo "uptime=$(uptime | sed "s/^ //")"
if [ -f /etc/os-release ]; then . /etc/os-release; echo "os=${PRETTY_NAME:-$NAME}"; fi
echo -n "cpu="; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
free -h 2>/dev/null | awk "/Mem:/{print \"mem_total=\"\$2\" mem_used=\"\$3\" mem_avail=\"\$7}"
df -h / 2>/dev/null | awk "NR==2{print \"disk_root=\"\$2\" used=\"\$3\" avail=\"\$4\" use%=\"\$5}"
echo -n "docker="; (docker --version 2>/dev/null || echo no)
echo -n "node="; (node -v 2>/dev/null || echo no)
echo -n "nginx="; (nginx -v 2>&1 || echo no)
echo -n "pm2="; (pm2 -v 2>/dev/null || echo no)
echo "listening:"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | egrep ":(80|443|3000|5173|8000|8080|9000|9922)\\b" | head -30
echo "dirs_home:"; ls /home 2>/dev/null | head -20
echo "dirs_ubuntu:"; ls /home/ubuntu 2>/dev/null | head -25
echo "dirs_www:"; ls /var/www 2>/dev/null | head -15
echo "dirs_opt:"; ls /opt 2>/dev/null | head -15
'

for h in "${hosts[@]}"; do
  echo "========== $h =========="
  # show HostName from config if possible
  awk -v host="$h" '
    $1=="Host" && $2==host {inhost=1; next}
    $1=="Host" {inhost=0}
    inhost && ($1=="HostName"||$1=="User"||$1=="Port"||$1=="ProxyJump") {print}
  ' ~/.ssh/config 2>/dev/null
  if timeout 15 ssh -o BatchMode=yes -o ConnectTimeout=7 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$h" "bash -lc $(printf %q "$remote_cmd")" 2>/tmp/probe-err.$$; then
    echo "REACHABLE=YES"
  else
    echo "REACHABLE=NO"
    sed -n '1,8p' /tmp/probe-err.$$ 2>/dev/null
  fi
  rm -f /tmp/probe-err.$$
  echo
done
