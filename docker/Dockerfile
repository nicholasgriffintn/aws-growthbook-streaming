FROM growthbook/growthbook

ENV GBHOME=/usr/local/src/app
WORKDIR $GBHOME

RUN apt-get update && \
  apt-get install -y curl telnet && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

RUN curl -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

EXPOSE 3000
EXPOSE 3100
