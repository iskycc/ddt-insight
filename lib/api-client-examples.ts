export const java8ClientExample = `import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DDT Insight 开放 API 客户端。
 * 兼容 JDK 8，只使用 JDK 标准库。
 */
public final class DdtInsightClient {
    private static final int CONNECT_TIMEOUT_MS = 3000;
    private static final int READ_TIMEOUT_MS = 5000;
    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

    private DdtInsightClient() {
    }

    /**
     * @param instanceUrl DDT Insight 实例地址，例如 http://127.0.0.1:3000
     * @param caseId      要查询的 CaseID
     * @return 用例字段 Map；CaseID 不存在时返回 null
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> getCase(
            String instanceUrl,
            String caseId
    ) throws IOException {
        String baseUrl = requireText(instanceUrl, "instanceUrl");
        String normalizedCaseId = requireText(caseId, "caseId");
        while (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }

        String encodedCaseId = URLEncoder
                .encode(normalizedCaseId, "UTF-8")
                .replace("+", "%20");
        URL url = new URL(
                baseUrl + "/api/case?caseId=" + encodedCaseId
        );
        HttpURLConnection connection =
                (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);

        try {
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_NOT_FOUND) {
                return null;
            }

            InputStream stream = status == HttpURLConnection.HTTP_OK
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = readUtf8(stream);

            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException(
                        "DDT Insight API HTTP " + status
                                + ": " + responseBody
                );
            }

            Object parsed = new JsonParser(responseBody).parse();
            if (!(parsed instanceof Map)) {
                throw new IOException("API 响应不是 JSON Object");
            }
            return (Map<String, Object>) parsed;
        } finally {
            connection.disconnect();
        }
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " 不能为空");
        }
        return value.trim();
    }

    private static String readUtf8(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) {
                    throw new IOException("API 响应超过 16 MB 上限");
                }
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), "UTF-8");
        } finally {
            stream.close();
        }
    }

    /**
     * 仅用于把 API JSON 转换为 Map/List/基本类型的小型解析器。
     */
    private static final class JsonParser {
        private final String source;
        private int offset;

        JsonParser(String source) {
            this.source = source == null ? "" : source;
        }

        Object parse() throws IOException {
            skipWhitespace();
            Object value = parseValue();
            skipWhitespace();
            if (offset != source.length()) {
                throw error("JSON 末尾存在多余内容");
            }
            return value;
        }

        private Object parseValue() throws IOException {
            skipWhitespace();
            if (offset >= source.length()) {
                throw error("JSON 意外结束");
            }
            char current = source.charAt(offset);
            if (current == '{') {
                return parseObject();
            }
            if (current == '[') {
                return parseArray();
            }
            if (current == '"') {
                return parseString();
            }
            if (current == 't') {
                expectLiteral("true");
                return Boolean.TRUE;
            }
            if (current == 'f') {
                expectLiteral("false");
                return Boolean.FALSE;
            }
            if (current == 'n') {
                expectLiteral("null");
                return null;
            }
            if (current == '-' || (current >= '0' && current <= '9')) {
                return parseNumber();
            }
            throw error("无法识别的 JSON 值");
        }

        private Map<String, Object> parseObject() throws IOException {
            expect('{');
            LinkedHashMap<String, Object> result =
                    new LinkedHashMap<String, Object>();
            skipWhitespace();
            if (consume('}')) {
                return result;
            }
            while (true) {
                skipWhitespace();
                if (offset >= source.length()
                        || source.charAt(offset) != '"') {
                    throw error("JSON Object 的键必须是字符串");
                }
                String key = parseString();
                skipWhitespace();
                expect(':');
                result.put(key, parseValue());
                skipWhitespace();
                if (consume('}')) {
                    return result;
                }
                expect(',');
            }
        }

        private List<Object> parseArray() throws IOException {
            expect('[');
            ArrayList<Object> result = new ArrayList<Object>();
            skipWhitespace();
            if (consume(']')) {
                return result;
            }
            while (true) {
                result.add(parseValue());
                skipWhitespace();
                if (consume(']')) {
                    return result;
                }
                expect(',');
            }
        }

        private String parseString() throws IOException {
            expect('"');
            StringBuilder result = new StringBuilder();
            while (offset < source.length()) {
                char current = source.charAt(offset++);
                if (current == '"') {
                    return result.toString();
                }
                if (current == '\\\\') {
                    if (offset >= source.length()) {
                        throw error("JSON 转义字符不完整");
                    }
                    char escaped = source.charAt(offset++);
                    switch (escaped) {
                        case '"':
                        case '\\\\':
                        case '/':
                            result.append(escaped);
                            break;
                        case 'b':
                            result.append('\\b');
                            break;
                        case 'f':
                            result.append('\\f');
                            break;
                        case 'n':
                            result.append('\\n');
                            break;
                        case 'r':
                            result.append('\\r');
                            break;
                        case 't':
                            result.append('\\t');
                            break;
                        case 'u':
                            result.append(parseUnicodeEscape());
                            break;
                        default:
                            throw error("JSON 转义字符无效");
                    }
                } else {
                    if (current < 0x20) {
                        throw error("JSON 字符串包含控制字符");
                    }
                    result.append(current);
                }
            }
            throw error("JSON 字符串没有结束引号");
        }

        private char parseUnicodeEscape() throws IOException {
            if (offset + 4 > source.length()) {
                throw error("Unicode 转义字符不完整");
            }
            int value = 0;
            for (int index = 0; index < 4; index++) {
                int digit = Character.digit(source.charAt(offset++), 16);
                if (digit < 0) {
                    throw error("Unicode 转义字符无效");
                }
                value = value * 16 + digit;
            }
            return (char) value;
        }

        private Number parseNumber() throws IOException {
            int start = offset;
            consume('-');
            if (consume('0')) {
                // 单个 0 已完成整数部分。
            } else {
                readDigits();
            }
            boolean decimal = false;
            if (consume('.')) {
                decimal = true;
                readDigits();
            }
            if (consume('e') || consume('E')) {
                decimal = true;
                if (!consume('+')) {
                    consume('-');
                }
                readDigits();
            }

            String token = source.substring(start, offset);
            try {
                return decimal
                        ? new BigDecimal(token)
                        : Long.valueOf(token);
            } catch (NumberFormatException error) {
                throw error("JSON 数字无效");
            }
        }

        private void readDigits() throws IOException {
            int start = offset;
            while (offset < source.length()) {
                char current = source.charAt(offset);
                if (current < '0' || current > '9') {
                    break;
                }
                offset++;
            }
            if (start == offset) {
                throw error("JSON 数字缺少数字");
            }
        }

        private void expectLiteral(String literal) throws IOException {
            if (!source.regionMatches(offset, literal, 0, literal.length())) {
                throw error("JSON 字面量无效");
            }
            offset += literal.length();
        }

        private void expect(char expected) throws IOException {
            skipWhitespace();
            if (!consume(expected)) {
                throw error("期望字符 " + expected);
            }
        }

        private boolean consume(char expected) {
            if (offset < source.length()
                    && source.charAt(offset) == expected) {
                offset++;
                return true;
            }
            return false;
        }

        private void skipWhitespace() {
            while (offset < source.length()) {
                char current = source.charAt(offset);
                if (current != ' '
                        && current != '\\n'
                        && current != '\\r'
                        && current != '\\t') {
                    return;
                }
                offset++;
            }
        }

        private IOException error(String message) {
            return new IOException(message + "，位置 " + offset);
        }
    }
}

// 调用示例：
// Map<String, Object> data = DdtInsightClient.getCase(
//         "http://127.0.0.1:3000", "CASE-001"
// );
// data 在 CaseID 不存在时为 null。`;

export const groovyClientExample = `import groovy.json.JsonSlurper

import java.net.HttpURLConnection
import java.net.URLEncoder

/**
 * DDT Insight 开放 API 客户端。
 * 适用于 Groovy 2.4+，只使用 Groovy/JDK 自带类。
 */
final class DdtInsightClient {
    private static final int CONNECT_TIMEOUT_MS = 3000
    private static final int READ_TIMEOUT_MS = 5000
    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024

    private DdtInsightClient() {
    }

    /**
     * @param instanceUrl DDT Insight 实例地址，例如 http://127.0.0.1:3000
     * @param caseId      要查询的 CaseID
     * @return 用例字段 Map；CaseID 不存在时返回 null
     */
    static Map<String, Object> getCase(
            String instanceUrl,
            String caseId
    ) {
        String baseUrl = requireText(instanceUrl, 'instanceUrl')
        String normalizedCaseId = requireText(caseId, 'caseId')
        while (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1)
        }

        String encodedCaseId = URLEncoder
                .encode(normalizedCaseId, 'UTF-8')
                .replace('+', '%20')
        URL url = new URL(
                baseUrl + '/api/case?caseId=' + encodedCaseId
        )
        HttpURLConnection connection =
                (HttpURLConnection) url.openConnection()
        connection.requestMethod = 'GET'
        connection.setRequestProperty('Accept', 'application/json')
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.useCaches = false

        try {
            int status = connection.responseCode
            if (status == HttpURLConnection.HTTP_NOT_FOUND) {
                return null
            }

            InputStream stream = status == HttpURLConnection.HTTP_OK
                    ? connection.inputStream
                    : connection.errorStream
            String responseBody = readUtf8(stream)

            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException(
                        'DDT Insight API HTTP ' + status
                                + ': ' + responseBody
                )
            }

            Object parsed = new JsonSlurper().parseText(responseBody)
            if (!(parsed instanceof Map)) {
                throw new IOException('API 响应不是 JSON Object')
            }
            return (Map<String, Object>) parsed
        } finally {
            connection.disconnect()
        }
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + ' 不能为空')
        }
        return value.trim()
    }

    private static String readUtf8(InputStream stream) {
        if (stream == null) {
            return ''
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream()
            byte[] buffer = new byte[8192]
            int total = 0
            int count
            while ((count = stream.read(buffer)) != -1) {
                total += count
                if (total > MAX_RESPONSE_BYTES) {
                    throw new IOException('API 响应超过 16 MB 上限')
                }
                output.write(buffer, 0, count)
            }
            return new String(output.toByteArray(), 'UTF-8')
        } finally {
            stream.close()
        }
    }
}

// 调用示例：
// Map<String, Object> data = DdtInsightClient.getCase(
//         'http://127.0.0.1:3000', 'CASE-001'
// )
// data 在 CaseID 不存在时为 null。`;
