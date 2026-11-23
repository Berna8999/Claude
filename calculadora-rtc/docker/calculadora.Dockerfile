# Imagem genérica das calculadoras oficiais da Receita Federal (Java 25).
#
# A mesma receita serve para os dois repositórios:
#   - calculadora-rtc-regime-regular  (porta 8080)
#   - calculadora-rtc-simples-nacional (porta 8082)
#
# O banco SQLite é sempre gerado a partir dos scripts Flyway do repositório
# Regime Regular: o Simples Nacional não tem plugin Flyway próprio e reaproveita
# esse mesmo banco (ver README do repositório Simples Nacional).

# ---------- 1. Banco de dados (Flyway do Regime Regular) ----------
FROM eclipse-temurin:25-jdk AS banco
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
ARG DB_REPO=https://github.com/ReceitaFederal/calculadora-rtc-regime-regular.git
ARG DB_REF=1.7.2
WORKDIR /src
RUN git clone --depth 1 --branch "${DB_REF}" "${DB_REPO}" regime-regular
WORKDIR /src/regime-regular
RUN mkdir -p calculadora/db \
 && ./mvnw -B -q flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf

# ---------- 2. Build do JAR da calculadora ----------
FROM eclipse-temurin:25-jdk AS build
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
ARG REPO
ARG REF
ARG JAR
WORKDIR /src
RUN git clone --depth 1 --branch "${REF}" "${REPO}" app
WORKDIR /src/app
RUN ./mvnw -B -q -DskipTests package \
 && cp "target/${JAR}.jar" /src/app.jar

# ---------- 3. Imagem final, só com o JRE ----------
FROM eclipse-temurin:25-jre
WORKDIR /opt/calculadora
COPY --from=banco /src/regime-regular/calculadora/db ./calculadora/db
COPY --from=build /src/app.jar ./app.jar
ARG PORTA=8080
EXPOSE ${PORTA}
ENTRYPOINT ["java", "-Dspring.profiles.active=offline", "-jar", "app.jar"]
