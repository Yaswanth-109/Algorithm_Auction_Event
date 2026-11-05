FROM python:3.12-slim-bookworm

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
      gcc g++ openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=1 -XX:+UseSerialGC -Xms16m -Xmx256m"
WORKDIR /workspace
