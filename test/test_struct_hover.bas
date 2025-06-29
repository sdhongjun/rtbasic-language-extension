' 测试结构体悬停功能

' 定义一个基本结构体
Global Structure Point
    Dim x As Integer
    Dim y As Integer
End Structure

' 定义一个包含结构体成员的结构体
Global Structure Rectangle
    Dim topLeft As Point
    Dim bottomRight As Point
    Dim color As Integer
End Structure

' 定义一个更复杂的结构体，包含数组和嵌套结构体
Global Structure Shape
    Dim name As String
    Dim rect As Rectangle
    Dim points(10) As Point
    Dim visible As Integer
End Structure

' 创建结构体实例
Dim p As Point
Dim r As Rectangle
Dim s As Shape

' 初始化结构体
p.x = 10
p.y = 20

r.topLeft = p
r.bottomRight.x = 100
r.bottomRight.y = 200
r.color = 0xFF0000

s.name = "MyShape"
s.rect = r
s.points(0).x = 5
s.points(0).y = 5
s.visible = 1

' 访问多级结构体成员
Print s.rect.topLeft.x
Print s.rect.bottomRight.y
Print s.points(0).x