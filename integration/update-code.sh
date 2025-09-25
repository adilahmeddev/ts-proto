#!/usr/bin/env bash

if [[ "$OSTYPE" == "msys" ]]; then
  PLUGIN_PATH="../protoc-gen-ts_proto.bat"
else
  PLUGIN_PATH="../protoc-gen-ts_proto"
fi

if [[ $# -eq 0 ]]; then
  if [[ -n "${INTEGRATION_TEST}" ]]; then
    echo "INTEGRATION_TEST is set ${INTEGRATION_TEST}"
    TESTS=$(find . -mindepth 1 -maxdepth 1 -type d -name $INTEGRATION_TEST)
  else
    echo "INTEGRATION_TEST is not set ${INTEGRATION_TEST}"
    TESTS=$(find . -mindepth 1 -maxdepth 1 -type d)
  fi
else
  echo '$# not eq 0'
  TESTS=$@
fi

for TEST in $TESTS; do
  echo "Test ${TEST}"
  cd "${TEST}"

  PARAMETERS_FILE="parameters.txt"
  if [ -f "$PARAMETERS_FILE" ]; then
    PARAMETERS=$(cat "$PARAMETERS_FILE")
  else
    PARAMETERS=""
  fi
  if [[ -n "${INTEGRATION_TEST}" ]]; then
    PROTO_FILES=$(find . -name "$INTEGRATION_TEST.proto" -type f)
  else
    PROTO_FILES=$(find . -name '*.proto' -type f)
  fi
  NODE_OPTIONS="--import tsx" protoc --experimental_allow_proto3_optional \
    "--plugin=$PLUGIN_PATH" \
    --ts_proto_opt="annotateFilesWithVersion=false,${PARAMETERS}" \
    --ts_proto_out=./ \
    $PROTO_FILES

  echo ""
  echo ""

  cd ..
done
