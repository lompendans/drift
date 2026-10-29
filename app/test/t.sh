# usage: t.sh 'js'  -> runs in Drift's main process;  t.sh shot file.png
if [ "$1" = shot ]; then curl -s -o "$2" http://127.0.0.1:9417/shot; else curl -s -X POST --data-binary "$1" http://127.0.0.1:9417/eval; fi
